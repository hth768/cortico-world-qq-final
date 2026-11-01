import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { OneBotMessage } from './types.ts';
import type { QZoneEventEnvelope } from './qzone.ts';

export type ReceiveMode = 'passive' | 'active' | 'hybrid';
export type InboxPayload = { kind: 'message'; event: OneBotMessage } | { kind: 'notice'; event: OneBotMessage }
  | { kind: 'qzone'; event: QZoneEventEnvelope };
export type InboxItem = InboxPayload & { id: number; address: string; receivedAt: number; selfId: number; bytes: number };
export const INBOX_LIMITS = { perConversation: 200, total: 2000, bytes: 16 * 1024 * 1024, entryBytes: 256 * 1024, ageMs: 7 * 86400_000 };

/** 混合模式只让私聊、明确 @ 自己和戳自己实时到达；主动模式无逐条唤醒例外。 */
export function shouldQueue(mode: ReceiveMode, ev: OneBotMessage, selfId: number): boolean {
  if (mode === 'passive') return false;
  if (mode === 'active') return true;
  if (ev.post_type === 'message') {
    if (ev.message_type === 'private') return false;
    const at = Array.isArray(ev.message)
      ? ev.message.some((s) => s.type === 'at' && selfId > 0 && Number(s.data.qq) === selfId)
      : selfId > 0 && new RegExp(`\\[CQ:at,qq=${selfId}(?:,|\\])`).test(ev.message ?? '');
    return !at;
  }
  if (ev.notice_type === 'notify' && ev.sub_type === 'poke') {
    const target = Number(ev.target_id) || 0;
    return !(target === 0 || target === Number(ev.user_id) || target === selfId);
  }
  return true;
}

/** 有界本地未读箱。内容仅在显式 read 时交给模型；存盘和统计均不触发模型事件。 */
export class QQInbox {
  private items: InboxItem[] = [];
  private nextId = 1;
  private timer?: ReturnType<typeof setTimeout>;
  private dirty = false;
  dropped = 0;
  checkAt: number | null = null;
  private file: string;
  private onError: (e: unknown) => void;
  private now: () => number;

  constructor(file = '', onError: (e: unknown) => void = () => {}, now = () => Date.now()) {
    this.file = file; this.onError = onError; this.now = now;
  }

  load(): void {
    if (!this.file || !existsSync(this.file)) return;
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (saved.version !== 1 || !Array.isArray(saved.items)) throw new Error('Unsupported QQ inbox state');
      this.items = [];
      for (const item of saved.items) {
        if (!Number.isSafeInteger(item.id) || item.id <= 0 || !Number.isSafeInteger(item.selfId) || item.selfId < 0 ||
          !Number.isFinite(item.receivedAt) || !/^(?:(?:group|private):[1-9]\d*|qzone)$/.test(item.address) ||
          !['message', 'notice', 'qzone'].includes(item.kind) || !item.event || typeof item.event !== 'object') continue;
        const bytes = Buffer.byteLength(JSON.stringify(item.event));
        if (bytes <= INBOX_LIMITS.entryBytes) this.items.push({ ...item, bytes });
      }
      this.nextId = Math.max(0, ...this.items.map((i) => i.id)) + 1;
      this.dropped = Number.isSafeInteger(saved.dropped) && saved.dropped >= 0 ? saved.dropped : 0;
      this.checkAt = Number.isFinite(saved.checkAt) && saved.checkAt > 0 ? saved.checkAt : null;
      this.trim();
    } catch (e) { this.onError(e); }
  }

  add(address: string, payload: InboxPayload, selfId = 0): void {
    if (!/^(?:(?:group|private):[1-9]\d*|qzone)$/.test(address)) return;
    if (payload.kind === 'message' && payload.event.message_id != null && this.items.some((i) => i.kind === 'message' &&
      i.selfId === selfId && i.address === address && i.event.message_id === payload.event.message_id)) return;
    const json = JSON.stringify(payload.event);
    const bytes = Buffer.byteLength(json);
    if (bytes > INBOX_LIMITS.entryBytes) this.dropped++;
    else this.items.push({ ...payload, event: JSON.parse(json), address, selfId, bytes, id: this.nextId++, receivedAt: this.now() });
    this.trim();
    this.changed();
  }

  /** 配置撤销授权后清除未读；下次重新启用监听也不会重放已撤销的数据。 */
  prune(allowed: (address: string, selfId: number) => boolean): void {
    const n = this.items.length;
    this.items = this.items.filter((i) => allowed(i.address, i.selfId));
    if (n !== this.items.length) this.changed();
    this.trim();
  }

  private trim(): void {
    const now = this.now();
    let bytes = 0;
    const counts = new Map<string, number>();
    const kept: InboxItem[] = [];
    for (const i of [...this.items].reverse()) {
      const n = counts.get(i.address) ?? 0;
      if (now - i.receivedAt > INBOX_LIMITS.ageMs || n >= INBOX_LIMITS.perConversation ||
        kept.length >= INBOX_LIMITS.total || bytes + i.bytes > INBOX_LIMITS.bytes) { this.dropped++; continue; }
      counts.set(i.address, n + 1);
      bytes += i.bytes;
      kept.push(i);
    }
    if (kept.length !== this.items.length) this.changed();
    this.items = kept.reverse();
  }

  summary() {
    this.trim();
    const conversations = new Map<string, { conversation: string; count: number; oldestAt: number; newestAt: number }>();
    for (const i of this.items) {
      const s = conversations.get(i.address) ?? { conversation: i.address, count: 0, oldestAt: i.receivedAt, newestAt: i.receivedAt };
      s.count++; s.newestAt = i.receivedAt; conversations.set(i.address, s);
    }
    return { total: this.items.length, conversations: [...conversations.values()], dropped: this.dropped, checkAt: this.checkAt };
  }

  select(address: string, limit: number): InboxItem[] {
    this.trim();
    const page: InboxItem[] = [];
    let bytes = 0;
    for (const item of this.items) {
      if (item.address !== address) continue;
      if (page.length >= limit || page.length > 0 && bytes + item.bytes > 64 * 1024) break;
      page.push(item); bytes += item.bytes;
    }
    return page;
  }

  acknowledge(id: number): void {
    this.items = this.items.filter((i) => i.id !== id);
    this.changed();
  }

  plan(at: number | null): void { this.checkAt = at; this.changed(); }

  private changed(): void {
    this.dirty = true;
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; this.flush(); }, 500);
    this.timer.unref();
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.file || !this.dirty) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items, checkAt: this.checkAt, dropped: this.dropped }), { mode: 0o600 });
      renameSync(tmp, this.file);
      this.dirty = false;
    } catch (e) { this.onError(e); }
  }
}
