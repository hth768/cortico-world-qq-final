import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GapRecovery } from '../src/gap-recovery.ts';
import { normalizeConfig } from '../src/config.ts';
import type { OneBotMessage } from '../src/types.ts';

const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  trace: () => {},
  child: () => silentLog,
} as never;

type Delivered = { address: string; id: number; stale: boolean };

/** 假的 OneBot 协议端：按 action + 锚点返回预置历史页。 */
function fakeApi(pages: Record<string, unknown[]>, calls: Array<{ action: string; params: Record<string, unknown> }>) {
  return async (action: string, params: Record<string, unknown>): Promise<unknown> => {
    calls.push({ action, params });
    const key = `${action}:${params.group_id ?? params.user_id}:${params.message_id}`;
    return { messages: pages[key] ?? [] };
  };
}

function historyMessage(overrides: Partial<OneBotMessage> & { message_id: number }): Record<string, unknown> {
  return {
    real_id: overrides.message_id,
    message_id: overrides.message_id,
    message_seq: overrides.message_seq ?? 0,
    time: overrides.time ?? 0,
    user_id: overrides.user_id ?? 0,
    message: overrides.message ?? [{ type: 'text', data: { text: 'x' } }],
    sender: { user_id: overrides.user_id ?? 0, nickname: 'n' },
  };
}

test('断档补收配置默认开启并补齐缺省字段', () => {
  const config = normalizeConfig({} as never);
  assert.deepEqual(config.gapRecovery, { enabled: true, groupStaleMinutes: 30, maxMessages: 120 });
  const custom = normalizeConfig({ gapRecovery: { enabled: false, groupStaleMinutes: 5 } } as never);
  assert.equal(custom.gapRecovery.enabled, false);
  assert.equal(custom.gapRecovery.groupStaleMinutes, 5);
  assert.equal(custom.gapRecovery.maxMessages, 120);
});

test('重连补收：群聊过旧只归档、私聊照常投递、负数消息号与自我消息正确处理', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'qq-gap-'));
  const stateFile = join(dir, 'cursors.json');
  const now = 1_800_000_000_000;
  const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  const delivered: Delivered[] = [];
  const seen = new Set<number>();
  const pages: Record<string, unknown[]> = {
    'get_group_msg_history:42:99': [
      historyMessage({ message_id: 100, message_seq: 10, time: 1_800_000_000 - 3_600, user_id: 7 }),
      historyMessage({ message_id: 101, message_seq: 11, time: 1_800_000_000 - 60, user_id: 8 }),
      historyMessage({ message_id: 102, message_seq: 12, time: 1_800_000_000 - 60, user_id: 3 }),
      historyMessage({ message_id: -700, message_seq: 13, time: 1_800_000_000 - 30, user_id: 9 }),
    ],
    'get_friend_msg_history:43:600': [
      historyMessage({ message_id: 601, message_seq: 1, time: 1_800_000_000 - 3_600, user_id: 43 }),
    ],
  };
  const recovery = new GapRecovery({
    stateFile,
    log: silentLog,
    api: fakeApi(pages, calls),
    selfId: () => 3,
    isSeen: (id) => seen.has(id),
    deliver: (address, event, stale) => delivered.push({ address, id: Number(event.message_id), stale }),
    groupStaleMs: () => 30 * 60_000,
    maxMessages: () => 50,
    now: () => now,
  });
  try {
    recovery.load();
    recovery.seed(new Map([
      ['99', { conv: 'group:42', ts: now - 120_000 }],
      ['600', { conv: 'private:43', ts: now - 60_000 }],
    ]));
    recovery.recoverAll(['group:42', 'private:43']);
    await recovery.drain();

    const groupCall = calls.find((c) => c.action === 'get_group_msg_history');
    assert.deepEqual(groupCall?.params, { group_id: 42, message_id: 99, count: 50, reverse_order: false });
    const privateCall = calls.find((c) => c.action === 'get_friend_msg_history');
    assert.deepEqual(privateCall?.params, { user_id: 43, message_id: 600, count: 50, reverse_order: false });
    assert.deepEqual(delivered, [
      { address: 'group:42', id: 100, stale: true },
      { address: 'group:42', id: 101, stale: false },
      { address: 'group:42', id: -700, stale: false },
      { address: 'private:43', id: 601, stale: false },
    ]);

    recovery.save();
    const saved = JSON.parse(readFileSync(stateFile, 'utf8')) as { cursors: Record<string, { messageId: number; seq: number }> };
    assert.equal(saved.cursors['group:42'].messageId, -700);
    assert.equal(saved.cursors['group:42'].seq, 13);
    assert.equal(saved.cursors['private:43'].messageId, 601);

    // 60 秒内重复的连接补收被节流。
    const callsBefore = calls.length;
    recovery.recoverAll(['group:42']);
    await recovery.drain();
    assert.equal(calls.length, callsBefore);

    // 实时跳档带旧锚点时必须补：否则新游标会把中间那段越过去。
    recovery.recover('group:42', 99);
    await recovery.drain();
    assert.equal(calls.length, callsBefore + 1);
    assert.equal(calls[calls.length - 1].params.message_id, 99);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('群序号跳档：自己发出的消息会抵扣，真实缺号才触发补收', () => {
  const recovery = new GapRecovery({
    stateFile: '',
    log: silentLog,
    api: async () => ({ messages: [] }),
    selfId: () => 3,
    isSeen: () => false,
    deliver: () => {},
    groupStaleMs: () => 0,
    maxMessages: () => 10,
    now: () => 1_800_000_000_000,
  });
  recovery.observeIncoming('group:42', { time: 1, self_id: 3, post_type: 'message', message_id: 200, message_seq: 10 } as OneBotMessage);
  recovery.noteSent('group:42', 201);
  recovery.noteSent('group:42', 202);
  assert.equal(recovery.gapBefore('group:42', 13), false);
  assert.equal(recovery.gapBefore('group:42', 14), true);
  recovery.observeIncoming('group:42', { time: 1, self_id: 3, post_type: 'message', message_id: 203, message_seq: 14 } as OneBotMessage);
  assert.equal(recovery.gapBefore('group:42', 15), false);
  assert.equal(recovery.gapBefore('private:43', 15), false);
});


test('补收等待期间停用或切换账号，不投递旧账号消息；游标不倒退', async () => {
  let account = 3;
  let enabled = true;
  let finish: (value: unknown) => void = () => {};
  const delivered: number[] = [];
  const recovery = new GapRecovery({ stateFile:'', log:silentLog,
    api:async()=>new Promise(resolve=>{finish=resolve;}), selfId:()=>account, isSeen:()=>false,
    active:()=>enabled, deliver:(_a,e)=>{delivered.push(e.message_id!);}, groupStaleMs:()=>0,maxMessages:()=>10 });
  recovery.observeIncoming('group:42',historyMessage({message_id:1,time:100,message_seq:1}) as never);
  recovery.recover('group:42',1);
  await new Promise(r=>setTimeout(r,0));
  enabled=false;
  finish({messages:[historyMessage({message_id:2,time:101,message_seq:2,user_id:8})]});
  await recovery.drain();
  assert.deepEqual(delivered,[]);
  enabled=true;
  recovery.recover('group:42',1);
  await new Promise(r=>setTimeout(r,0));
  recovery.observeIncoming('group:42',historyMessage({message_id:10,time:110,message_seq:10}) as never);
  finish({messages:[historyMessage({message_id:2,time:101,message_seq:2,user_id:8})]});
  await recovery.drain();
  assert.equal(recovery.cursorMessageId('group:42'),10);
  account=4;
  recovery.recover('group:42');
  await recovery.drain();
  assert.equal(recovery.cursorMessageId('group:42'),0);
});
