import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { downloadImage } from './image-download.ts';
import type { Logger } from 'cortico/core/types.ts';

/** 单张表情包的元数据（按内容 sha256 去重）。 */
export interface StickerMeta {
  /** 内容 sha256，去重主键。 */
  hash: string;
  /** 文件扩展名（含点）。 */
  ext: string;
  /** 相对表情包目录的文件名，bot 可经 [表情包:文件名] 引用发送。 */
  file: string;
  /** 来自 OneBot 的 summary（如「[表情]摸头」），空则无。 */
  summary: string;
  /** 情感标签（如 开心/撒娇/嘲讽/无奈），VLM 推断或「未知」。 */
  emotion: string;
  /** 适用场景（如 回应夸奖/表达无语），VLM 推断或「未知」。 */
  usage: string;
  /** 2-4 字短标签。 */
  tag: string;
  /** 给人看的短名（优先用 summary 清洗后）。 */
  label: string;
  firstSeen: number;
  lastSeen: number;
  /** 累计出现次数（去重后仍计数）。 */
  count: number;
  /** 出现过的会话地址列表。 */
  sources: string[];
  /** 若已加入 QQ 收藏表情（custom face），记录其 emoji_id；缺省则未同步到 QQ。 */
  emojiId?: string;
}

/** 视觉配置（直接复用 vision 段，标注情感/用处时调用 VLM）。 */
export interface StickerVisionCfg {
  enabled: boolean;
  endpoint: string;
  apiKeySecret: string;
  model: string;
  maxBytes: number;
  timeoutMs: number;
}

interface Job {
  url: string;
  conv: string;
  summary: string;
}

/**
 * 表情包自动收藏：下载 + 内容级去重（sha256）+ 情感/用处标注 + 持久化。
 *
 * - 仅当 sticker.enabled 时启用（world 在消息循环里判定表情包后调用 ingest）。
 * - 去重：相同内容只落盘一次，重复出现仅累加 count / 刷新 lastSeen / 记录来源。
 * - 情感/用处：优先用 OneBot summary；若 vision.enabled 且有 key，再用 VLM 结构化标注补全。
 * - 元数据持久化到 <dataDir>/sticker-index.json，跨重启仍生效。
 */
export class StickerStore {
  private readonly dir: string;
  private readonly vision: StickerVisionCfg;
  private readonly log: Logger;
  private readonly indexFile: string;
  private readonly meta = new Map<string, StickerMeta>();
  private inflight = 0;
  private readonly queue: Job[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly secret?: (name: string) => string;
  private readonly reportUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
  }, model: string) => void;
  /** 把一张表情图加入 QQ 收藏表情（custom face）的回调，由 world 注入；返回 emoji_id 或 null。 */
  private readonly addToFavoritesCb?: (bytes: Uint8Array, ext: string) => Promise<string | null>;

  constructor(
    dir: string,
    vision: StickerVisionCfg,
    log: Logger,
    dataDir = '',
    /** 部署级密钥读取器（框架 WorldContext.secret）。不得自行扫 providers 下的 .env。 */
    secret?: (name: string) => string,
    /** 用量上报（宿主 WorldHost.reportUsage）。 */
    reportUsage?: (usage: {
      promptTokens: number;
      completionTokens: number;
      cacheHitTokens: number;
      cacheMissTokens: number;
    }, model: string) => void,
    /** 把一张表情图加入 QQ 收藏表情（custom face）的回调，由 world 注入；返回 emoji_id 或 null。 */
    addToFavorites?: (bytes: Uint8Array, ext: string) => Promise<string | null>,
  ) {
    this.dir = dir;
    this.vision = vision;
    this.log = log.child('sticker');
    this.secret = secret;
    this.reportUsage = reportUsage;
    this.addToFavoritesCb = addToFavorites;
    this.indexFile = dataDir ? join(dataDir, 'sticker-index.json') : '';
    this.load();
    this.log.info(`StickerStore init indexFile=${this.indexFile} emojiDir=${this.dir} loaded=${this.meta.size}`);
    try {
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    } catch {
      this.log.warn('无法创建表情包目录', { dir: this.dir });
    }
  }

  get size(): number {
    return this.meta.size;
  }

  /** 消息里检测到表情包时调用（异步、不阻塞事件循环）。 */
  ingest(url: string, conv: string, summary: string): void {
    if (this.queue.length > 300) {
      this.log.warn('表情包队列已满，丢弃一条', { url });
      return;
    }
    this.queue.push({ url, conv, summary });
    this.pump();
  }

  /** 立即落盘（stop 时调用）。 */
  flush(): void {
    this.save();
  }

  /** 统计 + 最近列表，供 qq_sticker_stats 工具与控制台自查。 */
  stats(limit = 10): { total: number; byEmotion: Record<string, number>; synced: number; recent: StickerMeta[] } {
    const byEmotion: Record<string, number> = {};
    let synced = 0;
    for (const m of this.meta.values()) {
      byEmotion[m.emotion] = (byEmotion[m.emotion] ?? 0) + 1;
      if (m.emojiId) synced++;
    }
    const recent = [...this.meta.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit);
    return { total: this.meta.size, byEmotion, synced, recent };
  }

  /**
   * 把尚未加入 QQ 收藏表情的条目（无 emojiId）批量补推到 QQ「收藏表情」。
   * 用于开启开关前已攒下的历史表情一次性刷进 QQ。返回各计数。
   * 无回调（未接线）时所有条目记到 skipped，不报错。
   */
  async favoriteSync(max = 50): Promise<{ checked: number; added: number; failed: number; skipped: number }> {
    const r = { checked: 0, added: 0, failed: 0, skipped: 0 };
    if (!this.addToFavoritesCb) {
      r.skipped = this.meta.size;
      return r;
    }
    let n = 0;
    for (const m of this.meta.values()) {
      if (n >= max) break;
      if (m.emojiId) continue; // 已同步过
      r.checked++;
      n++;
      try {
        const buf = readFileSync(join(this.dir, m.file));
        const eid = await this.addToFavoritesCb(buf, m.ext);
        if (eid) {
          m.emojiId = eid;
          r.added++;
        } else {
          r.failed++;
        }
      } catch {
        r.failed++;
      }
    }
    if (r.added) this.save();
    return r;
  }

  /**
   * 按文件名定位一张表情包并更新其标注字段（emotion/usage/tag/label），随后调度落盘。
   * 这是除收货标注外唯一的写回通道，供 qq_sticker_tag 工具让 bot 自己修正/补充标注。
   * file 也接受 [表情包:xxx.jpg] 写法或省略扩展名的形式。找不到返回 null。
   */
  updateMeta(
    file: string,
    patch: { emotion?: string; usage?: string; tag?: string; label?: string },
  ): StickerMeta | null {
    let key = (file || '').trim();
    key = key.replace(/^\[表情包:/i, '').replace(/\]$/, '').trim();
    if (!key) return null;
    const want = key.toLowerCase();
    const m = [...this.meta.values()].find((x) => {
      const f = x.file.toLowerCase();
      return f === want || f.replace(/\.[^.]+$/, '') === want.replace(/\.[^.]+$/, '');
    });
    if (!m) return null;
    const clean = (s?: string) => (typeof s === 'string' ? s.trim().slice(0, 40) : '');
    const emo = clean(patch.emotion);
    const uso = clean(patch.usage);
    const tg = clean(patch.tag);
    const lb = clean(patch.label);
    if (emo) m.emotion = emo;
    if (uso) m.usage = uso;
    if (tg) m.tag = tg;
    if (lb) m.label = lb;
    this.scheduleSave();
    return m;
  }

  private pump(): void {
    if (this.inflight >= 4) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight++;
    void this.process(job).finally(() => {
      this.inflight--;
      this.pump();
    });
  }

  private async process(job: Job): Promise<void> {
    try {
      const bytes = await this.fetchBytes(job.url);
      if (!bytes) return;
      const hash = createHash('sha256').update(bytes).digest('hex');

      // 去重：已存在则只更新计数/来源，不重复落盘
      const existing = this.meta.get(hash);
      if (existing) {
        existing.count++;
        existing.lastSeen = Date.now();
        if (job.summary && !existing.summary) existing.summary = job.summary;
        if (!existing.sources.includes(job.conv)) existing.sources.push(job.conv);
        this.scheduleSave();
        return;
      }

      const ext = this.extOf(job.url, bytes);
      const file = `sticker-${hash.slice(0, 16)}${ext}`;
      writeFileSync(join(this.dir, file), bytes);

      const ann = this.vision.enabled ? await this.annotate(bytes) : { emotion: '未知', usage: '未知', tag: '' };
      const label = this.cleanSummary(job.summary) || ann.tag || '表情包';
      const meta: StickerMeta = {
        hash,
        ext,
        file,
        summary: job.summary || '',
        emotion: ann.emotion,
        usage: ann.usage,
        tag: ann.tag,
        label,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        count: 1,
        sources: [job.conv],
      };
      this.meta.set(hash, meta);
      this.log.info('表情包已收藏', { file, label, emotion: ann.emotion, usage: ann.usage });
      // 若开启了「同步到 QQ 收藏表情」，把同一张图加入 QQ 的 custom face（收藏表情），
      // 返回的 emoji_id 记进元数据，便于在 QQ 客户端里直接看到/使用。失败仅告警，不影响本机收藏。
      if (this.addToFavoritesCb) {
        try {
          const eid = await this.addToFavoritesCb(bytes, ext);
          if (eid) {
            meta.emojiId = eid;
            this.log.info('表情包已加入 QQ 收藏表情', { file, emojiId: eid });
          }
        } catch (e) {
          this.log.warn('加入 QQ 收藏表情回调异常（已忽略，仍按本机收藏处理）', { err: String(e), file });
        }
      }
      this.scheduleSave();
    } catch (e) {
      this.log.warn('表情包处理失败', { err: String(e), url: job.url });
    }
  }

  /** 用 VLM 结构化标注情感/用处；无 key 或失败时返回「未知」降级。
   *  密钥经框架 WorldContext.secret() 解析（部署 .env），不再直查 process.env。 */
  private async annotate(bytes: Uint8Array): Promise<{ emotion: string; usage: string; tag: string }> {
    let apiKey = '';
    try {
      apiKey = this.secret?.(this.vision.apiKeySecret)?.trim() || '';
    } catch { /* 密钥解析失败按无 key 降级 */ }
    if (!apiKey) {
      this.log.warn('缺视觉 API Key，表情包情感标注降级为未知', { secret: this.vision.apiKeySecret });
      return { emotion: '未知', usage: '未知', tag: '' };
    }
    const base64 = Buffer.from(bytes).toString('base64');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.vision.timeoutMs);
    try {
      const res = await fetch(`${this.vision.endpoint.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: this.vision.model,
          messages: [
            {
              role: 'system',
              content:
                '你是表情包分析助手。分析这张表情包并严格只输出一个 JSON：' +
                '{"emotion":"情感(如 开心/撒娇/嘲讽/无奈/愤怒/惊讶/喜爱/鼓励/无语)","usage":"适用场景(如 回应夸奖/表达无语/撒娇卖萌/表示赞同/吐槽/安慰)","tag":"2-4字短标签"}。' +
                '不要输出 JSON 以外的任何文字。',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: '分析这个表情包。' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return { emotion: '未知', usage: '未知', tag: '' };
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      this.reportUsage?.({
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      }, this.vision.model);
      return this.parseAnn(json.choices?.[0]?.message?.content?.trim());
    } catch {
      return { emotion: '未知', usage: '未知', tag: '' };
    } finally {
      clearTimeout(timer);
    }
  }

  private parseAnn(text?: string): { emotion: string; usage: string; tag: string } {
    if (!text) return { emotion: '未知', usage: '未知', tag: '' };
    try {
      const m = text.match(/\{[\s\S]*\}/);
      const o = m ? (JSON.parse(m[0]) as Record<string, unknown>) : null;
      if (o) {
        return {
          emotion: String(o.emotion || '未知'),
          usage: String(o.usage || '未知'),
          tag: String(o.tag || ''),
        };
      }
    } catch {
      /* 解析失败降级 */
    }
    return { emotion: '未知', usage: '未知', tag: '' };
  }

  private extOf(url: string, bytes: Uint8Array): string {
    const u = url.split('?')[0];
    const e = extname(u).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(e)) return e;
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return '.jpg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return '.png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return '.gif';
    if (bytes.length >= 12 && bytes.slice(0, 4).toString('hex') === '52494646') return '.webp';
    return '.img';
  }

  private cleanSummary(s: string): string {
    return (s || '').replace(/^\[表情\]/i, '').replace(/^\[emoji\]/i, '').trim();
  }

  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    return downloadImage(url, { timeoutMs: this.vision.timeoutMs, maxBytes: this.vision.maxBytes });
  }

  private load(): void {
    if (!this.indexFile || !existsSync(this.indexFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.indexFile, 'utf8')) as Record<string, StickerMeta>;
      for (const [k, v] of Object.entries(raw)) if (k === v.hash) this.meta.set(k, v);
    } catch {
      this.log.warn('表情包索引损坏，忽略', { file: this.indexFile });
    }
  }

  private scheduleSave(): void {
    if (!this.indexFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, 2000);
  }

  private save(): void {
    if (!this.indexFile) return;
    try {
      writeFileSync(this.indexFile, JSON.stringify(Object.fromEntries(this.meta)), 'utf8');
    } catch {
      this.log.warn('表情包索引写入失败', { file: this.indexFile });
    }
  }
}
