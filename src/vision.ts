import type { Logger } from 'cortico/core/types.ts';
import type { QQWorldConfig } from './config.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { downloadImage } from './image-download.ts';

/**
 * 被动视觉（可选，默认关闭）：下载图片并用 OpenAI 兼容端点（如 OpenRouter）VLM 描述。
 * 仅当 config.vision.enabled=true 时启用；失败时降级为占位，不阻塞事件。
 *
 * 与内置 qq 对齐的补强：
 * - 内容级去重（sha256 而非 url 摘要），并把去重表持久化到 dataDir，跨重启仍生效；
 * - 每次调用写用量归账（digest / 字节数 / 是否成功 / 耗时）到 <dataDir>/vision-accounting.jsonl；
 * - 暴露 viewImage()，供 qq_view_image 工具主动重看某张图。
 */
export class Vision {
  private readonly cfg: QQWorldConfig['vision'];
  private readonly log: Logger;
  /** sha256 -> 上次成功描述的时间（内容级去重，跨重启持久化）。 */
  private readonly seen = new Map<string, number>();
  private inflight = 0;
  private readonly queue: Array<{ url: string; expireAt: number; resolve: (s: string | null) => void }> = [];
  private readonly dataDir: string;
  private readonly seenFile: string;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * 模型来源解析器，由 QQWorld 注入（三项配置经框架 ctx.secret() 解析密钥）。
   * 未注入或配置不全时 describe 直接放弃，不再自行查 process.env。
   */
  private readonly resolveModel:
    | (() => { endpoint: string; apiKey: string; model: string } | null)
    | undefined;
  /** 用量上报（宿主 WorldHost.reportUsage）。 */
  private readonly reportUsage?: (usage: {
    promptTokens: number;
    completionTokens: number;
    cacheHitTokens: number;
    cacheMissTokens: number;
  }, model: string) => void;

  constructor(
    cfg: QQWorldConfig['vision'],
    log: Logger,
    dataDir = '',
    resolveModel?: () => { endpoint: string; apiKey: string; model: string } | null,
    reportUsage?: (usage: {
      promptTokens: number;
      completionTokens: number;
      cacheHitTokens: number;
      cacheMissTokens: number;
    }, model: string) => void,
  ) {
    this.cfg = cfg;
    this.log = log.child('vision');
    this.dataDir = dataDir;
    this.seenFile = dataDir ? join(dataDir, 'vision-seen.json') : '';
    this.resolveModel = resolveModel;
    this.reportUsage = reportUsage;
    this.loadSeen();
  }

  /** 注册一张待描述图片；并发已满则立即返回 null（本轮先不描述）。 */
  register(url: string, expireAt: number): Promise<string | null> | null {
    if (!this.cfg.enabled) return null;
    if (this.inflight >= this.cfg.maxConcurrent) return null;
    return new Promise<string | null>((resolve) => {
      this.queue.push({ url, expireAt, resolve });
      this.pump();
    });
  }

  private pump(): void {
    if (this.inflight >= this.cfg.maxConcurrent) return;
    const job = this.queue.shift();
    if (!job) return;
    this.inflight++;
    void this.process(job).finally(() => {
      this.inflight--;
      this.pump();
    });
  }

  private async process(job: { url: string; expireAt: number; resolve: (s: string | null) => void }): Promise<void> {
    const t0 = Date.now();
    try {
      const bytes = await this.fetchBytes(job.url);
      if (!bytes) {
        this.account('', 0, false, Date.now() - t0);
        return job.resolve(null);
      }
      const sha = createHash('sha256').update(bytes).digest('hex');
      const prev = this.seen.get(sha);
      if (prev !== undefined && Date.now() - prev < 6 * 3600_000) {
        this.account(sha, bytes.length, false, Date.now() - t0); // 内容去重：同图 6h 内不再算一次
        return job.resolve(null);
      }
      const desc = await this.describe(bytes);
      if (desc) {
        this.seen.set(sha, Date.now());
        this.saveSeenDebounced();
      }
      this.account(sha, bytes.length, !!desc, Date.now() - t0);
      job.resolve(desc);
    } catch (e) {
      this.log.warn('视觉描述失败', { err: String(e) });
      job.resolve(null);
    }
  }

  /** 主动重看一张图片（qq_view_image 用）：绕过去重，重新向 VLM 取描述。 */
  async viewImage(url: string): Promise<string | null> {
    const t0 = Date.now();
    const bytes = await this.fetchBytes(url);
    if (!bytes) {
      this.account('', 0, false, Date.now() - t0);
      return null;
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    const desc = await this.describe(bytes);
    this.account(sha, bytes.length, !!desc, Date.now() - t0);
    return desc;
  }

  private loadSeen(): void {
    if (!this.seenFile || !existsSync(this.seenFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.seenFile, 'utf8')) as Record<string, number>;
      for (const [k, v] of Object.entries(raw)) this.seen.set(k, v);
    } catch {
      /* 忽略损坏的归账文件 */
    }
  }

  private saveSeenDebounced(): void {
    if (!this.seenFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.saveSeen();
    }, 2000);
  }

  private saveSeen(): void {
    if (!this.seenFile) return;
    try {
      writeFileSync(this.seenFile, JSON.stringify(Object.fromEntries(this.seen)), 'utf8');
    } catch {
      /* 忽略写入失败 */
    }
  }

  /** 写一次 VLM 调用归账（内容摘要 + 字节数 + 是否成功 + 耗时）。 */
  private account(digest: string, bytes: number, ok: boolean, ms: number): void {
    if (!this.dataDir) return;
    try {
      appendFileSync(
        join(this.dataDir, 'vision-accounting.jsonl'),
        JSON.stringify({ ts: new Date().toISOString(), digest, bytes, ok, ms }) + '\n',
        'utf8',
      );
    } catch {
      /* 忽略写入失败 */
    }
  }

  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    return downloadImage(url, { timeoutMs: this.cfg.timeoutMs, maxBytes: this.cfg.maxBytes });
  }

  private async describe(bytes: Uint8Array): Promise<string | null> {
    // 模型来源一律走注入的解析器（由 QQWorld 经框架 ctx.secret() 解析密钥）。
    // 曾在这里直查 process.env，认证评审（#104）要求收敛到框架密钥读取器。
    const injected = this.resolveModel?.();
    if (!injected) {
      this.log.warn('辅助视觉未配置模型（模型地址/密钥名/模型名需在配置里填齐）');
      return null;
    }
    const endpoint = injected.endpoint;
    const apiKey = injected.apiKey;
    const model = injected.model;
    if (!apiKey) {
      this.log.warn('辅助视觉缺少 API Key', { secret: this.cfg.apiKeySecret || '(未指定)' });
      return null;
    }
    if (!model) {
      this.log.warn('辅助视觉未配置模型名', { endpoint });
      return null;
    }
    const base64 = Buffer.from(bytes).toString('base64');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${endpoint}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: '用一句话简要描述这张图片里的关键内容，用于群聊上下文。' },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
              ],
            },
          ],
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      // 自有模型调用上报用量（认证评审 #104 要求：控制台要能看到）。
      this.reportUsage?.({
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        cacheHitTokens: 0,
        cacheMissTokens: 0,
      }, model);
      const text = json.choices?.[0]?.message?.content?.trim();
      return text || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
