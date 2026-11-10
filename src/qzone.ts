// QQ 空间（事件驱动版）。
//
// 设计：本模块**不再调用任何第二模型**（独立的 LLM 地址/密钥/模型）。
// - 自动发动态：调度器到点只推一条 nudge 事件，由主模型用 qq_qzone（action=post） 工具发布（content 须由主模型显式给出）。
// - 评论自动回复：收到评论后推一条 nudge 事件，由主模型用 qq_qzone（action=reply） 工具回复。
// 这样动态/评论的内容都由主模型决定，语气与人格一致，且不需要单独的模型配置。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { isIP } from 'node:net';
import type { Logger } from 'cortico/core/types.ts';
import type { QQApi } from './types.ts';
import type { QQIdentity } from './definition.ts';
import type { QZoneConfig } from './config.ts';

export interface QZoneAutoReplyConfig {
  enabled: boolean;
  dailyQuota: number;
  cooldownSec: number;
}

export interface QZoneConfig {
  /** 是否启用 QQ 空间（动态/评论回复）。 */
  enabled: boolean;
  /** 自动冒泡：每 tick 概率发一条动态。 */
  tickSec: number;
  /** 每个 tick 自动发动态的概率（0~1）。 */
  chancePerTick: number;
  /** 每天自动发动态上限（0=不限）。 */
  dailyQuota: number;
  /** 可见权限 ugc_right：1 公开 / 4 好友 / 16 指定人(target_uins) / 64 仅自己 / 128 黑名单。 */
  permission: number;
  /** 动态配图模式。 */
  imageMode: 'none' | 'recent';
  /** 评论回复用的 OneBot action：'auto' 表示用内置正确值（NapCat/SnowLuma 为 'comment_qzone'），也可直接填协议端 action 名。 */
  commentAction: string;
  autoReplyComments: QZoneAutoReplyConfig;
}

export interface QZoneEventEnvelope {
  type: string;
  /** 必填：事件时间戳（ISO）。漏填会让 core event-store 按时间窗检索失准、消息行缺 [HH:MM]。 */
  ts: string;
  origin?: string;
  source?: string;
  senderKey?: string;
  text?: string;
  meta?: Record<string, unknown>;
}

export interface QZonePosterOptions {
  cfg: QZoneConfig;
  log: (...a: unknown[]) => void;
  dataDir: string;
  callApi: (action: string, params: Record<string, unknown>) => Promise<{ data?: unknown; error?: string }>;
  resolveLibraryImage?: (kind: string, name: string) => string | null;
  getContext: () => string;
  getRecentImageUrl: () => string | null;
  isPaused: () => boolean;
  /** 评论 ingestion：把评论作为外部事件喂给框架（沉淀记忆）。类型收紧为带 ts 的 envelope，漏字段编译期即报错。 */
  pushEvent: (e: QZoneEventEnvelope) => void;
  /** 由 world 注入：把"请主模型发一条动态/回一条评论"的请求交给主模型（事件驱动，不再用第二模型）。 */
  requestLLM: (nudge: string, kind: 'post' | 'reply', meta?: Record<string, unknown>) => void;
  identity: () => QQIdentity;
}

interface QZoneState {
  dailyCount: number;
  replyDailyCount: number;
  day: string;
  lastReplyAt: number;
  lastPosts: Array<{ tid: string; text: string }>;
}

export type QZonePostResult = { ok: true; tid?: string; text?: string } | { ok: false; error: string };

/** 模型提供的远程附图只允许访问公开 HTTP(S) 地址，拒绝本机、私网和云元数据地址。 */
function isPublicImageUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (u.username || u.password) return false;
    const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan')) return false;
    const ipKind = isIP(host);
    if (ipKind === 4) {
      const p = host.split('.').map(Number);
      const [a, b] = p;
      if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224) return false;
    } else if (ipKind === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe8') || host.startsWith('fe9') || host.startsWith('fea') || host.startsWith('feb'))) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** get_qzone_msg_detail 返回的单条评论/回复（已规整、剥内联 @ 标记）。 */
export interface QZoneCommentItem {
  commentId: string;
  uin: string;
  name: string;
  time: number;
  content: string;
  replies?: QZoneCommentItem[];
}

/** get_qzone_msg_detail 返回的动态详情（已规整，供模型省 token 消费）。 */
export interface QZonePostDetail {
  tid: string;
  content: string;
  commentNum: number;
  comments: QZoneCommentItem[];
}

export class QZonePoster {
  private readonly cfg: QZoneConfig;
  private readonly log: (...a: unknown[]) => void;
  private readonly dataDir: string;
  private readonly callApi: (action: string, params: Record<string, unknown>) => Promise<{ data?: unknown; error?: string }>;
  private readonly resolveLibraryImage: QZonePosterOptions['resolveLibraryImage'];
  private readonly getContext: () => string;
  private readonly getRecentImageUrl: () => string | null;
  private readonly isPaused: () => boolean;
  private readonly pushEvent: (e: QZoneEventEnvelope) => void;
  private readonly requestLLM: (nudge: string, kind: 'post' | 'reply', meta?: Record<string, unknown>) => void;
  private readonly identity: () => QQIdentity;

  private state: QZoneState = { dailyCount: 0, replyDailyCount: 0, day: '', lastReplyAt: 0, lastPosts: [] };
  private timer?: ReturnType<typeof setInterval>;
  private readonly scheduleKey = 'qzone-state.json';

  constructor(opts: QZonePosterOptions) {
    this.cfg = opts.cfg;
    this.resolveLibraryImage = opts.resolveLibraryImage;
    this.log = opts.log;
    this.dataDir = opts.dataDir;
    this.callApi = opts.callApi;
    this.getContext = opts.getContext;
    this.getRecentImageUrl = opts.getRecentImageUrl;
    this.isPaused = opts.isPaused;
    this.pushEvent = opts.pushEvent;
    this.requestLLM = opts.requestLLM;
    this.identity = opts.identity;
    this.load();
  }

  get enabled(): boolean {
    return this.cfg.enabled;
  }

  get scheduled(): boolean {
    return this.cfg.enabled && this.cfg.chancePerTick > 0;
  }

  start(): void {
    if (this.timer) return;
    const sec = Math.max(10, this.cfg.tickSec || 600);
    this.timer = setInterval(() => this.tick().catch((e) => this.log.error('tick error', e)), sec * 1000);
    this.log.info('started', { tickSec: sec });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** 发动态：content 须由调用方（主模型经 qq_qzone（action=post））显式提供。NapCat/SnowLuma 用扁平 action 名 send_qzone_msg + ugc_right。 */
  async post(opts: { content: string; images?: unknown; topic?: string; permission?: number | string }): Promise<QZonePostResult> {
    if (!this.cfg.enabled) return { ok: false, error: 'QQ 空间未启用（先在控制台开 worlds.qqbot.qzone.enabled）。' };
    const content = (opts.content || '').trim();
    if (!content) return { ok: false, error: '动态内容不能为空：请用 content 给出要发的内容（本扩展不再自动生成动态文本）。' };
    if (this.cfg.dailyQuota > 0 && this.state.dailyCount >= this.cfg.dailyQuota) {
      return { ok: false, error: `今天自动发动态已达上限（${this.cfg.dailyQuota}），请明天再发，或手动发。` };
    }
    let images: string[];
    try {
      images = this.prepareImages(opts.images === undefined ? this.collectImages() : opts.images);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : '无法读取附图' };
    }
    const params: Record<string, unknown> = {
      content, images,
      // NapCat/SnowLuma 的 send_qzone_msg 用 ugc_right（仅 1/4/16/64/128 合法）；旧的 'qzone.publish' + visible.type(2/8 非法) 会被拒。
      ugc_right: this.resolveUgcRight(opts.permission, this.cfg.permission),
    };
    if (opts.topic) params.topic = opts.topic;
    let raw: unknown;
    try {
      raw = await this.callApi('send_qzone_msg', params);
    } catch (e) {
      return { ok: false, error: `发布失败：${e instanceof Error ? e.message : String(e)}` };
    }
    // driver.callApi 已解包：raw 即 OneBot 返回的 data（send_qzone_msg 成功时为 null，SnowLuma 不返回 tid）。
    const tid = String((raw as { tid?: string } | null)?.tid ?? '');
    this.recordPost(tid, content);
    this.log.info('posted', { tid });
    return { ok: true, tid, text: content };
  }

  /** 解析可见权限：优先用调用方传入的 ugc_right 数字；否则按配置字符串语义映射。 */
  private resolveUgcRight(permArg: unknown, cfgPerm: unknown): number {
    const valid = new Set([1, 4, 16, 64, 128]);
    const map = (v: unknown): number => {
      if (typeof v === 'number' && valid.has(v)) return v;
      if (typeof v === 'string') {
        switch (v) {
          case 'owner': return 64; // 仅自己
          case 'friend':
          case 'admin': return 4;  // 好友
          default: return 1;       // all / 其它 → 公开
        }
      }
      return 1;
    };
    return permArg !== undefined && permArg !== null ? map(permArg) : map(cfgPerm);
  }

  /** 回复评论（由主模型经 qq_qzone（action=reply） 调用）。NapCat/SnowLuma 用 comment_qzone，只能对整个动态发表新评论，不支持按 comment_id 回楼中楼。 */
  async replyComment(commentId: string, text: string, tid?: string): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!text?.trim()) return { ok: false, error: '评论内容为空。' };
    if (!tid) return { ok: false, error: '缺少 tid（动态 id）。' };
    // commentAction 为 'auto' 时用内置正确 action（NapCat/SnowLuma 为 'comment_qzone'）；否则用配置里填的协议端 action 名。
    const action = this.cfg.commentAction && this.cfg.commentAction !== 'auto' ? this.cfg.commentAction : 'comment_qzone';
    try {
      await this.callApi(action, { tid, content: text });
    } catch (e) {
      return { ok: false, error: `回复失败：${e instanceof Error ? e.message : String(e)}` };
    }
    this.log.info('replied comment', { commentId, tid });
    return { ok: true };
  }

  /**
   * 拉取一条动态的详情与全部评论（SnowLuma `get_qzone_msg_detail`；NapCat 不一定提供，失败会返回 error）。
   * @param tid 动态 id（来自 feeds 返回或 post 回执）
   * @param uin 动态作者（贴主）QQ 号，来自 feeds 返回；查好友动态时必传，自家动态可省略。
   */
  async getDetail(tid: string, uin?: number): Promise<{ ok: boolean; detail?: QZonePostDetail; error?: string }> {
    if (!this.cfg.enabled) return { ok: false, error: 'QQ空间未启用' };
    const tidStr = String(tid ?? '').trim();
    if (!tidStr) return { ok: false, error: '缺少 tid（动态 id，来自 feeds 返回）。' };
    const params: Record<string, unknown> = { tid: tidStr };
    const u = Number(uin);
    if (Number.isFinite(u) && u > 0) params.target_uin = u;
    let raw: unknown;
    try {
      raw = await this.callApi('get_qzone_msg_detail', params);
    } catch (e) {
      return { ok: false, error: `获取动态详情失败：${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true, detail: QZonePoster.normalizeDetail(raw, tidStr) };
  }

  /** 把 get_qzone_msg_detail 的返回规整成省 token 的结构；字段缺失时给默认值（协议端字段随版本可能变化）。 */
  private static normalizeDetail(raw: unknown, tid: string): QZonePostDetail {
    const d = (raw ?? {}) as Record<string, unknown>;
    const pickItems = (list: unknown): QZoneCommentItem[] => {
      if (!Array.isArray(list)) return [];
      return list.map((it) => {
        const c = (it ?? {}) as Record<string, unknown>;
        const item: QZoneCommentItem = {
          commentId: String(c.comment_id ?? c.commentId ?? ''),
          uin: String(c.uin ?? ''),
          name: String(c.name ?? '').trim(),
          time: Number(c.time ?? 0),
          content: QZonePoster.humanizeAtMarks(String(c.content ?? '')),
        };
        const replies = pickItems(c.replies);
        if (replies.length) item.replies = replies;
        return item;
      });
    };
    return {
      tid: String(d.tid ?? tid),
      content: typeof d.content === 'string' ? d.content : '',
      commentNum: Number(d.comment_num ?? 0),
      comments: pickItems(d.comments),
    };
  }

  /** 把评论里 QQ 空间的内联 @ 标记（@{uin:xxx,nick:yyy,...}）转成可读的 "@yyy(uin:xxx)"，方便模型直接看懂要 @ 谁。 */
  private static humanizeAtMarks(text: string): string {
    return text
      .replace(/@\{[^}]*?uin:([^,}]+)[^}]*?nick:([^,}]+)[^}]*?\}/g, (_m, u, n) => `@${String(n).trim()}(uin:${String(u).trim()})`)
      .replace(/@\{[^}]*?nick:([^,}]+)[^}]*?uin:([^,}]+)[^}]*?\}/g, (_m, n, u) => `@${String(n).trim()}(uin:${String(u).trim()})`);
  }

  async getFeeds(num: number): Promise<{ ok: boolean; feeds?: unknown[]; hasMore?: boolean; error?: string }> {
    if (!this.cfg.enabled) return { ok: false, error: 'QQ空间未启用' };
    // NapCat/SnowLuma 用 get_qzone_feeds，参数为 { page_num, count }。
    let raw: unknown;
    try {
      raw = await this.callApi('get_qzone_feeds', { page_num: 1, count: num });
    } catch (e) {
      return { ok: false, error: `获取动态列表失败：${e instanceof Error ? e.message : String(e)}` };
    }
    // driver.callApi 已解包：raw 即 data（{ feeds, has_more }）；feed 句柄字段是 key（非 tid）。
    const data = (raw ?? {}) as { feeds?: Array<Record<string, unknown>>; has_more?: boolean };
    // 条目含 HTML 片段，剥标签给模型可读文本；tid 映射为 key 供评论/点赞/删除动作定位该动态。
    const feeds = (data.feeds ?? []).map((f) => ({
      tid: f.key,
      uin: f.uin,
      nickname: f.nickname,
      time: f.time,
      appid: f.appid,
      text: typeof f.html === 'string' ? QZonePoster.stripHtml(String(f.html)) : (typeof f.content === 'string' ? f.content : ''),
    }));
    return { ok: true, feeds, hasMore: !!data.has_more };
  }

  /** 把 QQ空间动态 feed 的 HTML 片段转成可读纯文本（供模型消费）。 */
  private static stripHtml(html: string): string {
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li)>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim();
  }

  async delete(tid: string): Promise<{ ok: boolean; error?: string }> {
    // NapCat/SnowLuma 用 delete_qzone_msg。
    try {
      await this.callApi('delete_qzone_msg', { tid });
    } catch (e) {
      return { ok: false, error: `删除失败：${e instanceof Error ? e.message : String(e)}` };
    }
    return { ok: true };
  }

  private collectImages(): string[] {
    if (this.cfg.imageMode === 'none') return [];
    const url = this.getRecentImageUrl();
    return url ? [url] : [];
  }

  /** 显式 [] 表示纯文字；每张图都须有效，才允许调用发布 API。 */
  private prepareImages(input: unknown): string[] {
    if (!Array.isArray(input)) throw new Error('images 必须是数组。');
    let remaining = 8 * 1024 * 1024;
    return input.map((value, i) => {
      const fail = (why: string): never => { throw new Error(`第 ${i + 1} 张附图：${why}；本条未发布。`); };
      if (typeof value !== 'string') return fail('需提供图片链接或资料库标记');
      if (isPublicImageUrl(value)) return value;
      const prefix = /^(?:base64:\/\/|data:image\/[a-z0-9.+-]+;base64,)/i.exec(value);
      if (prefix) {
        const data = value.slice(prefix[0].length);
        if (data.length > Math.ceil(remaining / 3) * 4) return fail('内联图片合计超过 8 MiB');
        if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.replace(/=+$/, '').length % 4 === 1 ||
            (data.endsWith('=') && data.length % 4 !== 0)) return fail('base64 数据无效');
        remaining -= Buffer.from(data, 'base64').length;
        if (remaining < 0) return fail('内联图片合计超过 8 MiB');
        return value;
      }
      const marker = /^\[(图片|表情包):([^\[\]\r\n]{1,200})\]$/.exec(value);
      if (!marker) return fail('仅支持公开图片链接、base64、[图片:文件名] 或 [表情包:文件名]');
      const file = this.resolveLibraryImage?.(marker[1], marker[2].trim());
      if (!file) return fail('资料库中找不到指定的普通文件或路径不安全');
      // 只读取校验过的库内文件；按实际文件大小限制内存，再确认图片文件头。
      let fd: number | undefined;
      let bytes: Buffer;
      try {
        fd = fs.openSync(file, 'r');
        const st = fs.fstatSync(fd);
        if (!st.isFile()) return fail('不是普通文件');
        if (st.size > remaining) return fail('内联图片合计超过 8 MiB');
        bytes = Buffer.alloc(st.size);
        let n = 0;
        while (n < bytes.length) {
          const got = fs.readSync(fd, bytes, n, bytes.length - n, null);
          if (!got) return fail('文件读取不完整');
          n += got;
        }
      } catch (e) {
        if (e instanceof Error && e.message.endsWith('本条未发布。')) throw e;
        return fail('文件不可读取');
      } finally { if (fd !== undefined) fs.closeSync(fd); }
      const head = bytes.subarray(0, 12);
      if (!(head.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex')) ||
            head.subarray(0, 3).equals(Buffer.from([255,216,255])) ||
            /^GIF8[79]a/.test(head.toString('latin1')) ||
            (head.toString('ascii',0,4) === 'RIFF' && head.toString('ascii',8,12) === 'WEBP')))
        return fail('本地附图仅支持 PNG、JPEG、GIF、WebP');
      remaining -= bytes.length;
      return 'base64://' + bytes.toString('base64');
    });
  }

  /** 评论事件：沉淀为外部事件 + 若开启自动回复则请主模型回复。 */
  onEvent(e: { type?: string; data?: Record<string, unknown> }): void {
    const data = (e.data ?? {}) as Record<string, unknown>;
    if (e.type !== 'qq.message.comment.new') return;
    const tid = String(data.tid ?? '');
    const commentId = String(data.commentId ?? '');
    if (!commentId) return;
    const p = data as { text?: string; operatorNick?: string };
    // 1) 把评论作为外部事件喂给框架（沉淀记忆、让 bot「看见」）
    this.pushEvent({
      type: 'qq.qzone.comment',
      origin: 'external',
      source: 'qq',
      ts: new Date().toISOString(),
      senderKey: `qzone:${tid}`,
      text: `QQ空间评论 ${p.operatorNick ? '(' + p.operatorNick + ')' : ''}：${p.text ?? ''}`,
      meta: { conv: `qzone:${tid}`, tid, commentId },
    });
    // 2) 自动回复：事件驱动（请主模型调 qq_qzone（action=reply）），不再用第二模型生成
    if (this.cfg.commentAction !== 'auto' || !this.cfg.autoReplyComments.enabled) return;
    this.rolloverDay();
    const now = Date.now();
    if (now - this.state.lastReplyAt < this.cfg.autoReplyComments.cooldownSec * 1000) return;
    if (this.cfg.autoReplyComments.dailyQuota > 0 && this.state.replyDailyCount >= this.cfg.autoReplyComments.dailyQuota) return;
    this.state.lastReplyAt = now;
    this.state.replyDailyCount += 1;
    this.save();
    // 评论原文（来自任意评论者，不可信）放进 meta；text 只放指令，不含外部内容。
    const nudge = '你的 QQ 空间动态下有一条新评论。请用 qq_qzone（action=reply） 工具回复，自然一句话，可带 emoji，别客套别太长。评论原文、评论者、tid、comment_id 都在事件 meta 里。';
    this.requestLLM(nudge, 'reply', {
      tid,
      commentId,
      operatorNick: p.operatorNick || '对方',
      original: p.text ?? '',
    });
  }

  private async tick(): Promise<void> {
    if (!this.cfg.enabled) return;
    if (this.isPaused()) return;
    this.rolloverDay();
    if (this.cfg.dailyQuota > 0 && this.state.dailyCount >= this.cfg.dailyQuota) return;
    if (Math.random() >= this.cfg.chancePerTick) return;
    const ctx = this.getContext().slice(-3000);
    const nudge =
      '请你以第一人称主动发一条 QQ 空间动态（说说），可用 qq_qzone（action=post） 工具发布。' +
      '内容像你自己真实的朋友圈碎碎念：对最近聊天里某件事/某个人发表真实看法、吐槽、安利或简介，或分享当下心情。' +
      '自然、有梗、带点小情绪，1-3 句最佳，最多不超 100 字，可带少量 emoji，不要客服腔。' +
      '最近聊天的取材放在事件 meta.context 里，可据此发挥。';
    this.requestLLM(nudge, 'post', ctx ? { context: ctx } : {});
  }

  private rolloverDay(): void {
    const d = new Date().toISOString().slice(0, 10);
    if (d !== this.state.day) {
      this.state.day = d;
      this.state.dailyCount = 0;
      this.state.replyDailyCount = 0;
    }
  }

  private recordPost(tid: string, text: string): void {
    this.rolloverDay();
    this.state.dailyCount += 1;
    this.state.lastPosts.unshift({ tid, text });
    if (this.state.lastPosts.length > 10) this.state.lastPosts.pop();
    this.save();
  }

  status(): { enabled: boolean; dailyQuota: number; dailyCount: number; autoReply: boolean; replyDailyCount: number; lastPosts: Array<{ tid: string; text: string }> } {
    return {
      enabled: this.cfg.enabled,
      dailyQuota: this.cfg.dailyQuota,
      dailyCount: this.state.dailyCount,
      autoReply: this.cfg.commentAction === 'auto' && this.cfg.autoReplyComments.enabled,
      replyDailyCount: this.state.replyDailyCount,
      lastPosts: this.state.lastPosts,
    };
  }

  // ---- 持久化（保留，用于每日配额/冷却判定 + 最近动态展示） ----
  private load(): void {
    try {
      const file = path.join(this.dataDir, this.scheduleKey);
      if (fs.existsSync(file)) {
        const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (typeof raw.dailyCount === 'number') this.state.dailyCount = raw.dailyCount;
        if (typeof raw.replyDailyCount === 'number') this.state.replyDailyCount = raw.replyDailyCount;
        if (typeof raw.day === 'string') this.state.day = raw.day;
        if (typeof raw.lastReplyAt === 'number') this.state.lastReplyAt = raw.lastReplyAt;
        if (Array.isArray(raw.lastPosts)) this.state.lastPosts = raw.lastPosts;
      }
    } catch (e) {
      this.log.warn('load failed', e);
    }
  }

  private save(): void {
    try {
      const file = path.join(this.dataDir, this.scheduleKey);
      fs.mkdirSync(this.dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(this.state), 'utf8');
    } catch (e) {
      this.log.warn('save failed', e);
    }
  }
}
