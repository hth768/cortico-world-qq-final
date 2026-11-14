import type { ToolDef, WorldHost } from 'cortico/core/types.ts';
import { shortTime } from 'cortico/core/util.ts';
import { externalDataBlock } from './external-data.ts';

export interface HistoryCtx {
  getHost: () => WorldHost | null;
  sourceId: string;
  timezone: string;
  convLabel: (address: string) => string;
  isListened: (address: string) => boolean;
}

/** 群聊历史查询工具（Cortico 内置 world 的可增量特性）。 */
export function makeHistoryTools(ctx: HistoryCtx): ToolDef[] {
  return [
    {
      name: 'qq_history',
      tags: ['read'],
      description:
        '聊天历史查询系列（用一个 action 选子功能）：' +
        'recent=查某个群或私聊本地已收录的消息（按时间倒序）；' +
        'search=在本地已收录的 QQ 消息中按关键词检索（keyword 必填）。' +
        '仅覆盖已投递和已查收归档的消息。hybrid/active 的积压未读请用 qq_inbox 查看，可用 read 的 order=newest 接上最新话题。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['recent', 'search'], description: '子功能：recent 查最近 / search 关键词检索。' },
          group: { type: 'number', description: '【recent】群号；与 peer 二选一。' },
          peer: { type: 'number', description: '【recent】私聊对方 QQ；与 group 二选一。' },
          minutes: { type: 'number', description: '【recent】已收录消息的回溯时间窗（分钟），默认 60；积压未读需用 qq_inbox 查询。' },
          limit: { type: 'number', description: '【recent】最多返回条数，默认 30；【search】最多返回命中组数，默认 10。' },
          keyword: { type: 'string', description: '【search】不区分大小写的包含匹配关键词。' },
        },
        required: ['action'],
      },
      handler: async (args) => {
        const action = String(args.action ?? '');
        const host = ctx.getHost();
        if (!host) return '历史存储尚未就绪。';
        switch (action) {
          case 'recent': {
            const group = typeof args.group === 'number' ? args.group : Number(args.group ?? 0);
            const peer = typeof args.peer === 'number' ? args.peer : Number(args.peer ?? 0);
            const address = group ? `group:${group}` : peer ? `private:${peer}` : '';
            if (!address) return '请提供 group 或 peer。';
            if (!ctx.isListened(address)) return '只能查询当前监听名单内的群或私聊，避免读取未授权会话。';
            const limit = Math.min(Number(args.limit ?? 30), 100);
            const minutes = Number(args.minutes ?? 60);
            const fromTs = new Date(Date.now() - minutes * 60_000).toISOString();
            const events = host.store
              .range({ source: ctx.sourceId, senderKey: address, fromTs, limit: limit * 4 })
              .filter((e) => e.type === 'qq.message')
              .slice(-limit)
              .reverse();
            if (!events.length) return `${ctx.convLabel(address)} 在最近 ${minutes} 分钟内暂无已收录消息。请用 qq_inbox(action=peek) 检查未读积压，判断群内活动还需查看最新未读。`;
            const label = ctx.convLabel(address);
            const lines = events.map(
              (e) => `[${shortTime(ctx.timezone, new Date(e.ts))}] ${e.senderKey ?? ''} ${e.text}`,
            );
            return externalDataBlock(`QQ 历史资料（${label}）`, `${label} 最近消息：\n${lines.join('\n')}`);
          }
          case 'search': {
            const keyword = String(args.keyword ?? '').trim();
            if (!keyword) return '请提供 keyword。';
            const limit = Math.min(Number(args.limit ?? 10), 30);
            const hits = host.store
              .grep({ keyword, source: ctx.sourceId, limit: limit * 2, context: 1 })
              .map((h) => ({ ...h, events: h.events.filter((e) => ctx.isListened(e.senderKey ?? '')) }))
              .filter((h) => h.events.length)
              .slice(0, limit);
            if (!hits.length) return `本地已收录记录中没有找到包含「${keyword}」的 QQ 消息。积压未读请用 qq_inbox 查看。`;
            const blocks = hits.map((h) => {
              const lines = h.events.map((e) => `[${shortTime(ctx.timezone, new Date(e.ts))}] ${e.senderKey ?? ''} ${e.text}`);
              return lines.join('\n');
            });
            return externalDataBlock(`QQ 历史检索资料（关键词：${keyword}）`, `检索「${keyword}」命中 ${hits.length} 处：\n\n${blocks.join('\n\n')}`);
          }
          default:
            return `未知 action：「${action}」（支持 recent/search）。`;
        }
      },
    },
  ];
}
