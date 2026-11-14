/** OneBot v11 数据模型（本扩展自包含，不依赖 core 内部模块）。 */

export type OneBotSegment =
  | { type: 'text'; data: { text: string } }
  | { type: 'markdown'; data: { content?: string } }
  | { type: 'at'; data: { qq: number | string; name?: string } }
  | { type: 'face'; data: { id: number | string } }
  | { type: 'image'; data: { file: string; url?: string; summary?: string } }
  | { type: 'sticker'; data: { file?: string; url?: string; summary?: string } }
  | { type: 'record'; data: { file: string; url?: string } }
  | { type: 'video'; data: { file: string; url?: string } }
  | { type: 'file'; data: { file: string; url?: string; name?: string } }
  | { type: 'reply'; data: { id: string } }
  | { type: 'forward'; data: { id: string } }
  | { type: 'json'; data: { data: string } }
  | { type: 'xml'; data: { data: string } };

export interface OneBotMessage {
  time: number;
  self_id: number;
  post_type: 'message' | 'message_sent' | 'notice' | 'meta_event' | 'request';
  message_type?: 'private' | 'group';
  sub_type?: string;
  message_id?: number;
  /** 服务器消息序号（群聊为 NT seq，私聊为发送端本地序号）。 */
  message_seq?: number;
  group_id?: number;
  user_id?: number;
  target_id?: number;
  sender?: OneBotSender;
  anonymous?: { id: number; name: string; flag: string } | null;
  message?: OneBotSegment[] | string;
  raw_message?: string;
  font?: number;
  // notice
  notice_type?: string;
  operator_id?: number;
  comment?: string;
  /** group_upload / 扩展文件事件的元数据；仅作资料，不作为内部指令。 */
  file?: { id?: string; file_id?: string; name?: string; size?: number; busid?: number | string; url?: string; file?: string; path?: string };
  flag?: string;
  // meta
  meta_event_type?: string;
  status?: string | Record<string, unknown>;
  // API 回包关联字段
  echo?: string | number;
  retcode?: number;
  data?: unknown;
}

export interface OneBotSender {
  user_id?: number;
  nickname?: string;
  sex?: string;
  age?: number;
  card?: string;
  role?: string;
  title?: string;
  level?: string;
}

export interface QQSenderBrief {
  userId: number;
  name: string;
  card?: string;
  role?: string;
  title?: string;
}

export type ConvKind = 'group' | 'private';

export interface Conv {
  kind: ConvKind;
  /** group id 或 private peer id */
  id: number;
  /** 'group:123' | 'private:123' */
  address: string;
  /** 群名 / 私聊对方昵称 */
  label: string;
  /** 监听中的群/私聊对应 fat-fish 的 activeGroupIds / activePrivatePeers */
  active: boolean;
  /** 最近一次聚合时间（私聊聚合用） */
  lastAggregatedAt?: number;
  members?: Map<number, QQSenderBrief>;
  unread?: { count: number; lastActiveAt: number };
  lastMessageAt?: number;
  /** 最近一条人类发言里 @ 提及的目标 QQ（不含 bot 自身），供禁言等管理工具兜底。 */
  lastAtUserId?: number;
  /** 最近一条人类发言所引用消息的原作者 QQ（优先级高于 lastAtUserId）。 */
  quotedSenderId?: number;
  pendingAggregatedText?: { text: string; firstAt: number };
  /** 私聊聚合到期冲刷计时器（窗口内未再来消息时，把暂存文本投递给 AI）。 */
  aggregationTimer?: ReturnType<typeof setTimeout>;
}

export interface QQIdentity {
  selfId: number;
  nickname: string;
  /** groupId -> 群名 */
  groups: Map<number, string>;
  /** 好友列表：QQ 号 -> { 昵称, 备注 }。备注优先用作称呼（私聊里她该喊的名字）。 */
  friends: Map<number, { nickname: string; remark?: string }>;
  /** userId -> { nickname, card } 供离线名片回退 */
  knownPeers: Map<number, { nickname: string; card?: string }>;
  /** nickname 唯一冲突的 userId 集合 */
  nicknameConflicts: Set<number>;
  loadedAt: number;
}
