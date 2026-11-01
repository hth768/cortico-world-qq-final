import type { DescribeText, EventDescribe } from 'cortico/core/types.ts';
import type { WorldDefinition } from 'cortico/world.ts';
import { describeTools } from 'cortico/world.ts';
import { QQWorld } from './world.ts';
import { qqDefaults, qqTimezoneOptions, type QQConfigSection } from './config.ts';

/** 每个工具一句给人看的话;市场与扩展页按界面语言取。 */
const TOOL_SUMMARIES: Record<string, DescribeText> = {
  qq_inbox: {
    zh: 'QQ 主动查收：看积压、按会话和条数读取、预约或取消一次查收提醒。',
    en: 'QQ inbox: inspect unread counts, read a chosen conversation, or schedule/cancel a one-time check reminder.',
  },
  qq_send: {
    zh: '回复 QQ 消息的唯一渠道:往群或私聊发一条消息,可引用回复、@人,由主模型决定是否转成语音。',
    en: 'The only way to answer a QQ message: send one to a group or private chat, with quoting, mentions, and an optional voice reply chosen by the main model.',
  },
  qq_confirm_send: {
    zh: '兼容别名:qq_send 现已直接发送,通常无需调用。',
    en: 'Compatibility alias. qq_send already sends directly, so this is rarely needed.',
  },
  qq_view_image: {
    zh: '主动重看一张刚收到的 QQ 图片,取回它的文字描述。',
    en: 'Take another look at a received QQ picture and get its description.',
  },
  qq_image: {
    zh: '独立图片库:保存最近图片、查看文件名、修改标注或删除。',
    en: 'Separate image library: save recent pictures, list files, edit annotations, or delete.',
  },
  qq_file: {
    zh: '普通文件资料库:保存收到的文件、查看文件名、修改标注、删除或发回 QQ。',
    en: 'File library: save received files, list filenames, edit annotations, delete, or send them back to QQ.',
  },
  qq_sticker_stats: {
    zh: '查看已收藏表情包的统计与真实文件名,发图前先取文件名。',
    en: 'List collected stickers with their real filenames, needed before replying with one.',
  },
  qq_sticker_tag: {
    zh: '修改某张表情包的标注(情感/用处/标签/显示名),改完即持久化。',
    en: 'Edit the annotation (emotion/usage/tag/label) of one collected sticker and persist it.',
  },
  qq_proactive: {
    zh: '主动说话调度器:查状态(status)或手动触发一次(trigger)。',
    en: 'Proactive-speaking scheduler: check status or fire one manually.',
  },
  qq_qzone: {
    zh: 'QQ 空间动态:发(post)/删(delete)/回评论(reply)/列动态(feeds)/看状态(status)。',
    en: 'QQ Zone: post / delete / reply to comment / list feeds / show status.',
  },
  qq_poke: {
    zh: '戳一戳某个人(群内或私聊)。',
    en: 'Poke someone, in a group or privately.',
  },
  qq_reminder: {
    zh: '定时提醒/闹钟(也是记事本):记(add)/列(list)/取消(cancel)。',
    en: 'Timed reminder / alarm (also a notepad): add / list / cancel.',
  },
  qq_admin: {
    zh: '【群管理员】撤回/@全体/公告/审加群/头衔/禁言/全员禁言/踢人,用一个 action 选子功能。',
    en: 'Group admin: recall / mention-all / notice / review joins / title / mute / whole-mute / kick, picked by one action.',
  },
  qq_history: {
    zh: '聊天历史:查最近消息(recent)或关键词检索(search)。',
    en: 'Chat history: recent messages or keyword search.',
  },
};

const EVENTS: EventDescribe[] = [
  {
    type: 'qq.inbox-check',
    description: { zh: 'bot 自行预约的单次查收提醒，仅含积压数量，不含聊天正文；无未读不唤醒。', en: 'An explicitly scheduled one-time inbox reminder, containing counts only; silent when empty.' },
  },
  {
    type: 'qq.message',
    description: {
      zh: '一条监听到的群聊或私聊消息,已通过唤醒判断,进入本轮处理。',
      en: 'A listened group or private message that passed the wake check and entered this turn.',
    },
  },
  {
    type: 'qq.file',
    description: {
      zh: '收到一个文件后的资料通知；文件名和标注只作为外部资料，文件保存在独立文件库。',
      en: 'A file receipt notice; filenames and annotations are external data, stored in the separate file library.',
    },
  },
  {
    type: 'qq.group-request',
    description: {
      zh: '有人申请加群或被邀请进群,等待管理员审批。',
      en: 'Someone requested to join the group or was invited, awaiting admin approval.',
    },
  },
  {
    type: 'system',
    description: {
      zh: '系统提示:连接状态、或用运行时信息替换占位符后的说明文字。',
      en: 'A system notice: connection state, or text whose placeholders were filled at runtime.',
    },
  },
  {
    type: 'qq.recall',
    description: {
      zh: '某条群消息被撤回。',
      en: 'A group message was recalled.',
    },
  },
  {
    type: 'qq.member',
    description: {
      zh: '群成员变动:有人进群或退群。',
      en: 'Group membership changed: someone joined or left.',
    },
  },
  {
    type: 'qq.poke',
    description: {
      zh: '有人戳了戳机器人,或被机器人戳。',
      en: 'Someone poked the bot, or the bot poked someone.',
    },
  },
  {
    type: 'qq.react',
    description: {
      zh: '有人给某条消息贴了表情回应。',
      en: 'A message received an emoji reaction.',
    },
  },
  {
    type: 'qq.forward',
    description: {
      zh: '收到一条合并转发消息。',
      en: 'A merged-forward message arrived.',
    },
  },
  {
    type: 'qq.proactive',
    description: {
      zh: '主动说话调度器唤起的一次主动发言:由 qq_proactive 触发器或定时 routine 发起,进入本轮主动处理。',
      en: 'A proactive speaking turn raised by the scheduler: fired by qq_proactive trigger or the timed routine, entering this active turn.',
    },
  },
  {
    type: 'qq.qzone.post',
    description: {
      zh: '发了一条 QQ 空间说说(或带图/带权限的说说)后回执的事件。',
      en: 'Event returned after posting a QQ Zone shout (optionally with images or visibility rights).',
    },
  },
  {
    type: 'qq.qzone.reply',
    description: {
      zh: '回复了一条 QQ 空间评论后回执的事件。',
      en: 'Event returned after replying to a QQ Zone comment.',
    },
  },
  {
    type: 'qq.qzone.comment',
    description: {
      zh: '收到一条 QQ 空间评论的通知。',
      en: 'Notice that a QQ Zone comment was received.',
    },
  },
  {
    type: 'qq.reminder',
    description: {
      zh: '定时提醒/闹钟到点触发,或记事本项被唤起,进入本轮处理。',
      en: 'A timed reminder/alarm fired, or a notepad item was raised, entering this turn.',
    },
  },
];

export const definition: WorldDefinition<QQConfigSection> = {
  id: 'qqbot',
  label: 'QQ 群聊',
  defaults: qqDefaults,
  configOptions(kind) {
    if (kind === 'qq-timezone') return qqTimezoneOptions();
    return [];
  },
  create(ctx) {
    // 密钥一律走框架 WorldContext.secret（部署 .env，按部署隔离）；
    // 不得自行扫描 providers/*/.env（认证评审 #104）。
    return new QQWorld(ctx.cfg, ctx.packageDir, ctx.dataDir, (name) => ctx.secret(name));
  },
  describe: {
    tools: describeTools(QQWorld.describeToolSpecs(), TOOL_SUMMARIES),
    events: EVENTS,
  },
};
