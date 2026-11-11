import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { Logger } from 'cortico/core/types.ts';
import type { OneBotMessage } from './types.ts';

/**
 * 断档补收（gap recovery）
 *
 * 协议端（SnowLuma / NapCat）只会把「它推到手里的事件」交给本扩展；连接断开、
 * 协议端掉线或 QQ 静默丢推送时，中间会缺一段消息，bot 事后完全看不见。
 *
 * 这里用 OneBot 的历史接口（get_group_msg_history / get_friend_msg_history，
 * SnowLuma 支持从 QQ 服务器回源并落库）把「本扩展最后见过的那条之后」补回来：
 * - 每次（重新）连上协议端时，按会话补一次；
 * - 运行中群消息序号出现跳档时，立即补一次；
 * - 补回的私聊消息照常投递（要求回复）；
 * - 补回的群消息若距现在太久，只进未读箱，不唤醒、不要求回复。
 *
 * 游标与 seen 集合落盘，跨重启仍能从上次看到的位置继续，不会重复补旧消息。
 */

export interface GapCursor {
  /** 最后见过（收到或自己发出）的消息 id，作为历史接口的锚点。 */
  messageId: number;
  /** 群消息的服务器序号（NT seq）；私聊不用。 */
  seq: number;
  /** 该消息的发送时间（毫秒），用于判断补档是否“太久”。 */
  timeMs: number;
}

interface GapStateFile {
  version: 1;
  cursors: Record<string, GapCursor>;
}

export interface GapRecoveryOptions {
  /** 游标文件路径；空字符串表示不落盘（测试用）。 */
  stateFile: string;
  log: Logger;
  /** 调 OneBot action；失败应 reject。 */
  api: (action: string, params: Record<string, unknown>) => Promise<unknown>;
  /** 当前登录账号 QQ。 */
  selfId: () => number;
  /** 已处理过的消息 id 判断（与实时消息去重共用）。 */
  isSeen: (messageId: number) => boolean;
  /** 把补回的消息交给 World：stale=true 表示群聊补档过旧，只归档不唤醒。 */
  deliver: (address: string, ev: OneBotMessage, stale: boolean) => void;
  /** 群聊消息超过此毫秒视为“太久”，不要求回复。 */
  groupStaleMs: () => number;
  /** 单会话一次补档最多补多少条。 */
  maxMessages: () => number;
  now?: () => number;
}

const PAGE_SIZE = 50;
const MAX_PAGES = 5;
const MIN_RECOVER_INTERVAL_MS = 60_000;
const SAVE_DEBOUNCE_MS = 1_500;

export class GapRecovery {
  private readonly cursors = new Map<string, GapCursor>();
  /** 群消息里本扩展自己发出、但不知道服务器序号的条数（用于避免把自发言当成断档）。 */
  private readonly selfSendCredit = new Map<string, number>();
  private readonly lastRecoverAt = new Map<string, number>();
  private readonly inflight = new Set<string>();
  private tail: Promise<void> = Promise.resolve();
  private saveTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  private readonly opts: GapRecoveryOptions;
  private readonly now: () => number;

  constructor(opts: GapRecoveryOptions) {
    this.opts = opts;
    this.now = opts.now ?? Date.now;
  }

  load(): void {
    if (!this.opts.stateFile || !existsSync(this.opts.stateFile)) return;
    try {
      const raw = JSON.parse(readFileSync(this.opts.stateFile, 'utf8')) as Partial<GapStateFile>;
      for (const [address, value] of Object.entries(raw?.cursors ?? {})) {
        const cursor = sanitizeCursor(value);
        if (cursor) this.cursors.set(address, cursor);
      }
      this.opts.log.info('已恢复断档游标', { count: this.cursors.size });
    } catch (e) {
      this.opts.log.warn('读取断档游标失败', { err: String(e) });
    }
  }

  /**
   * 首次启用时用 knownMessages 里「每个会话最新见过的那条」作为锚点，
   * 这样升级后不用等到下一条消息才知道从哪补。
   */
  seed(known: Map<string, { conv: string; ts: number }>): void {
    const newest = new Map<string, { id: number; ts: number }>();
    for (const [idText, value] of known) {
      const id = Number(idText);
      const address = value?.conv;
      if (!Number.isSafeInteger(id) || id === 0 || typeof address !== 'string' || !address) continue;
      const ts = Number(value.ts) || 0;
      const prev = newest.get(address);
      if (!prev || ts >= prev.ts) newest.set(address, { id, ts });
    }
    let seeded = 0;
    for (const [address, value] of newest) {
      if (this.cursors.has(address)) continue;
      this.cursors.set(address, { messageId: value.id, seq: 0, timeMs: value.ts });
      seeded += 1;
    }
    if (seeded > 0) this.scheduleSave();
  }

  /** 实时收到的消息（含自己的回显）：推进游标并清掉自发言信用。 */
  observeIncoming(address: string, ev: OneBotMessage): void {
    const id = Number(ev.message_id);
    const timeSec = Number(ev.time);
    const cursor = this.cursors.get(address) ?? { messageId: 0, seq: 0, timeMs: 0 };
    if (Number.isSafeInteger(id) && id !== 0) cursor.messageId = id;
    if (Number.isFinite(timeSec) && timeSec > 0) cursor.timeMs = timeSec * 1000;
    if (address.startsWith('group:')) {
      const seq = Number(ev.message_seq);
      if (Number.isSafeInteger(seq) && seq > cursor.seq) cursor.seq = seq;
    }
    this.cursors.set(address, cursor);
    this.selfSendCredit.set(address, 0);
    this.scheduleSave();
  }

  /** 自己成功发出的消息：推进锚点；群聊不知道序号时记信用，避免下次误判断档。 */
  noteSent(address: string, messageId: number): void {
    if (!Number.isSafeInteger(messageId) || messageId === 0) return;
    const cursor = this.cursors.get(address) ?? { messageId: 0, seq: 0, timeMs: 0 };
    cursor.messageId = messageId;
    cursor.timeMs = this.now();
    this.cursors.set(address, cursor);
    if (address.startsWith('group:')) {
      this.selfSendCredit.set(address, (this.selfSendCredit.get(address) ?? 0) + 1);
    }
    this.scheduleSave();
  }

  /**
   * 收到群消息前判断序号是否跳档。seq 是服务器序号，每有一人发言就 +1；
   * 自己发出的消息也会占号，所以用 selfSendCredit 抵扣。
   */
  gapBefore(address: string, seq: number): boolean {
    if (!address.startsWith('group:')) return false;
    const cursor = this.cursors.get(address);
    if (!cursor || cursor.seq <= 0 || !Number.isSafeInteger(seq) || seq <= 0) return false;
    const expected = cursor.seq + 1 + (this.selfSendCredit.get(address) ?? 0);
    return seq > expected;
  }

  /** 当前游标里的消息 id；群消息跳档时用它作为补收锚点，避免被实时消息推进后漏掉中间段。 */
  cursorMessageId(address: string): number {
    return this.cursors.get(address)?.messageId ?? 0;
  }

  /** 连接建立：把所有监听会话排进补收队列（串行，避免同时打协议端）。 */
  recoverAll(addresses: Iterable<string>): void {
    for (const address of addresses) {
      this.tail = this.tail
        .then(() => this.recoverNow(address))
        .catch((e) => this.opts.log.warn('断档补收失败', { address, err: String(e) }));
    }
  }

  /** 单会话补收（内部串行）。传入 anchorId 时从该锚点补起（实时跳档检测用）。 */
  recover(address: string, anchorId?: number): void {
    this.tail = this.tail
      .then(() => this.recoverNow(address, anchorId))
      .catch((e) => this.opts.log.warn('断档补收失败', { address, err: String(e) }));
  }

  private async recoverNow(address: string, anchorId?: number): Promise<void> {
    if (this.inflight.has(address)) return;
    const cursor = this.cursors.get(address);
    const selfId = this.opts.selfId();
    if (!cursor || cursor.messageId === 0 || selfId <= 0) return;
    const now = this.now();
    // 连接补收做节流；实时跳档带了更早的锚点，必须补，否则中间那段会被新游标越过。
    if (anchorId === undefined && now - (this.lastRecoverAt.get(address) ?? 0) < MIN_RECOVER_INTERVAL_MS) return;
    const [kind, idText] = address.split(':');
    const sessionId = Number(idText);
    if ((kind !== 'group' && kind !== 'private') || !Number.isSafeInteger(sessionId) || sessionId <= 0) return;
    this.inflight.add(address);
    this.lastRecoverAt.set(address, now);
    const maxMessages = Math.max(1, Math.trunc(this.opts.maxMessages()));
    const groupStaleMs = Math.max(0, this.opts.groupStaleMs());
    let anchor = Number.isSafeInteger(anchorId) && anchorId !== 0 ? anchorId : cursor.messageId;
    let fetchedTotal = 0;
    let deliveredTotal = 0;
    try {
      for (let page = 0; page < MAX_PAGES && fetchedTotal < maxMessages; page += 1) {
        const count = Math.min(PAGE_SIZE, maxMessages - fetchedTotal);
        const data = await this.opts.api(kind === 'group' ? 'get_group_msg_history' : 'get_friend_msg_history', {
          [kind === 'group' ? 'group_id' : 'user_id']: sessionId,
          message_id: anchor,
          count,
          reverse_order: false,
        });
        const items = historyMessages(data);
        if (!items.length) break;
        const events = items
          .map((item) => toOneBotMessage(item, kind, sessionId, selfId))
          .filter((ev): ev is OneBotMessage => ev !== null)
          .sort((a, b) => Number(a.time) - Number(b.time) || Number(a.message_seq) - Number(b.message_seq));
        if (!events.length) break;
        const nextAnchor = Number(events[events.length - 1].message_id);
        let pageFetched = 0;
        for (const ev of events) {
          const id = Number(ev.message_id);
          if (!Number.isSafeInteger(id) || id === 0) continue;
          if (id === anchor) continue;
          if (this.opts.isSeen(id)) continue;
          pageFetched += 1;
          if (Number(ev.user_id) === selfId) continue;
          const stale = kind === 'group' && groupStaleMs > 0 && this.now() - Number(ev.time) * 1000 > groupStaleMs;
          this.opts.deliver(address, ev, stale);
          deliveredTotal += 1;
        }
        fetchedTotal += pageFetched;
        this.advanceCursor(address, events, kind);
        if (!Number.isSafeInteger(nextAnchor) || nextAnchor === 0 || nextAnchor === anchor) break;
        anchor = nextAnchor;
        if (pageFetched === 0 || events.length < count) break;
      }
      if (fetchedTotal > 0) {
        this.opts.log.info('断档补收完成', { address, fetched: fetchedTotal, delivered: deliveredTotal });
      }
    } catch (e) {
      this.opts.log.warn('断档补收请求失败', { address, err: String(e) });
    } finally {
      this.inflight.delete(address);
      this.scheduleSave();
    }
  }

  private advanceCursor(address: string, events: OneBotMessage[], kind: 'group' | 'private'): void {
    const cursor = this.cursors.get(address) ?? { messageId: 0, seq: 0, timeMs: 0 };
    for (const ev of events) {
      const id = Number(ev.message_id);
      if (Number.isSafeInteger(id) && id !== 0) cursor.messageId = id;
      const timeSec = Number(ev.time);
      if (Number.isFinite(timeSec) && timeSec > 0) cursor.timeMs = Math.max(cursor.timeMs, timeSec * 1000);
      if (kind === 'group') {
        const seq = Number(ev.message_seq);
        if (Number.isSafeInteger(seq) && seq > cursor.seq) cursor.seq = seq;
      }
    }
    this.cursors.set(address, cursor);
  }

  private scheduleSave(): void {
    if (!this.opts.stateFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      this.save();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  save(): void {
    if (!this.opts.stateFile) return;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    try {
      const cursors: Record<string, GapCursor> = {};
      for (const [address, cursor] of this.cursors) cursors[address] = cursor;
      const payload: GapStateFile = { version: 1, cursors };
      writeFileSync(this.opts.stateFile, JSON.stringify(payload), 'utf8');
    } catch (e) {
      this.opts.log.warn('保存断档游标失败', { err: String(e) });
    }
  }

  /** 等待队列排空（测试/停用用）。 */
  async drain(): Promise<void> {
    await this.tail;
  }
}

function sanitizeCursor(value: unknown): GapCursor | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const messageId = Number(record.messageId);
  const seq = Number(record.seq);
  const timeMs = Number(record.timeMs);
  if (!Number.isSafeInteger(messageId) || messageId === 0) return null;
  return {
    messageId,
    seq: Number.isSafeInteger(seq) && seq > 0 ? seq : 0,
    timeMs: Number.isFinite(timeMs) && timeMs > 0 ? timeMs : 0,
  };
}

/** 历史接口返回的是去掉 post_type/self_id 的事件本体（带 real_id）。 */
function historyMessages(data: unknown): unknown[] {
  if (!data || typeof data !== 'object' || !('messages' in data)) return [];
  return Array.isArray(data.messages) ? data.messages : [];
}

function toOneBotMessage(raw: unknown, kind: 'group' | 'private', sessionId: number, selfId: number): OneBotMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const realId = 'real_id' in raw ? raw.real_id : undefined;
  const messageIdField = 'message_id' in raw ? raw.message_id : undefined;
  const messageId = Number(realId ?? messageIdField);
  if (!Number.isSafeInteger(messageId) || messageId === 0) return null;
  const sender = readSender(raw);
  const userIdField = 'user_id' in raw ? raw.user_id : undefined;
  const userId = Number(userIdField ?? sender?.user_id ?? 0);
  const message = readMessage(raw);
  const timeField = 'time' in raw ? raw.time : undefined;
  const seqField = 'message_seq' in raw ? raw.message_seq : undefined;
  const rawMessageField = 'raw_message' in raw ? raw.raw_message : undefined;
  const ev: OneBotMessage = {
    time: Number(timeField) || 0,
    self_id: selfId,
    post_type: 'message',
    message_type: kind,
    message_id: messageId,
    message_seq: Number(seqField) || 0,
    user_id: userId,
    sender,
    message,
    raw_message: typeof rawMessageField === 'string' ? rawMessageField : '',
  };
  if (kind === 'group') ev.group_id = sessionId;
  else ev.target_id = sessionId;
  return ev;
}

/** `sender` 是历史事件里的展示资料，只取本扩展渲染需要的字段。 */
function readSender(raw: object): OneBotMessage['sender'] | undefined {
  if (!('sender' in raw)) return undefined;
  const value = raw.sender;
  if (!value || typeof value !== 'object') return undefined;
  const readString = (key: string): string | undefined => {
    const field = Reflect.get(value, key);
    return typeof field === 'string' ? field : undefined;
  };
  const userId = 'user_id' in value ? Number(value.user_id) : undefined;
  return {
    user_id: Number.isSafeInteger(userId) ? userId : undefined,
    nickname: readString('nickname'),
    card: readString('card'),
    role: readString('role'),
    title: readString('title'),
    sex: readString('sex'),
    level: readString('level'),
  };
}

/** 历史事件的消息段：数组或 CQ 字符串；结构由协议端保证，这里只做类型收窄。 */
function readMessage(raw: object): OneBotMessage['message'] | undefined {
  if (!('message' in raw)) return undefined;
  const value = raw.message;
  if (Array.isArray(value)) return value as OneBotMessage['message'];
  if (typeof value === 'string') return value;
  return undefined;
}
