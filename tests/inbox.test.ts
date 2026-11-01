import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QQInbox, INBOX_LIMITS, shouldQueue } from '../src/inbox.ts';
import { normalizeConfig } from '../src/config.ts';
import type { OneBotMessage } from '../src/types.ts';

const message = (id = 1): OneBotMessage => ({ time: 1, self_id: 10001, post_type: 'message', message_type: 'group',
  group_id: 12345, user_id: 23456, message_id: id, message: [{ type: 'text', data: { text: '这是外部正文' } }] });

test('未设置或无效配置默认混合，保留显式选择；主动/混合模式的 @、私聊、戳一戳分流', () => {
  assert.equal(normalizeConfig({} as never).receiveMode, 'hybrid');
  assert.equal(normalizeConfig({ receiveMode: 'invalid' } as never).receiveMode, 'hybrid');
  for (const mode of ['active', 'passive', 'hybrid']) assert.equal(normalizeConfig({ receiveMode: mode } as never).receiveMode, mode);
  const group = message();
  const at = { ...group, message: [...group.message as any[], { type: 'at', data: { qq: '10001' } }] };
  const privateMessage = { ...group, message_type: 'private' as const };
  const poke: OneBotMessage = { ...group, post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 10001 };
  for (const e of [group, at, privateMessage, poke]) {
    assert.equal(shouldQueue('active', e, 10001), true);
    assert.equal(shouldQueue('passive', e, 10001), false);
  }
  assert.equal(shouldQueue('hybrid', group, 10001), true);
  for (const e of [at, privateMessage, poke]) assert.equal(shouldQueue('hybrid', e, 10001), false);
  assert.equal(shouldQueue('hybrid', { ...group, message: '[CQ:at,qq=10001] 你好' }, 10001), false);
  assert.equal(shouldQueue('hybrid', { ...poke, target_id: 99999 }, 10001), true);
});

test('未读分页、重复消息去重、重启恢复和一次性预约持久化', () => {
  const dir = mkdtempSync(join(tmpdir(), 'qq-inbox-'));
  const path = join(dir, 'inbox.json');
  try {
    const box = new QQInbox(path);
    for (let n = 1; n <= 8; n++) box.add('group:12345', { kind: 'message', event: message(n) }, 10001);
    box.add('group:12345', { kind: 'message', event: message(8) }, 10001);
    box.add('private:23456', { kind: 'message', event: message(9) }, 10001);
    box.plan(Date.now() + 300000);
    box.flush();
    const restored = new QQInbox(path);
    restored.load();
    assert.deepEqual(restored.summary(), box.summary());
    assert.equal(restored.summary().total, 9);
    const page = restored.select('group:12345', 3);
    for (const item of page) restored.acknowledge(item.id);
    assert.equal(restored.select('group:12345', 20).length, 5);
    assert.equal(restored.select('private:23456', 20).length, 1);
    restored.plan(null); restored.flush();
    const again = new QQInbox(path); again.load();
    assert.equal(again.summary().total, 6);
    assert.equal(again.checkAt, null);
    assert.doesNotMatch(JSON.stringify(again.summary()), /这是外部正文/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('按会话/总量/大小/有效期限制存储并报告清理数量', () => {
  let now = 1000000;
  const box = new QQInbox('', undefined, () => now);
  for (let n = 0; n < 250; n++) box.add('group:12345', { kind: 'message', event: message(n) });
  assert.equal(box.summary().total, 200);
  assert.equal(box.summary().dropped, 50);
  for (let n = 0; n < 2100; n++) box.add(`group:${n + 1}`, { kind: 'message', event: message(n) });
  assert.equal(box.summary().total, INBOX_LIMITS.total);
  box.add('group:1', { kind: 'message', event: { ...message(5000), message: 'x'.repeat(INBOX_LIMITS.entryBytes + 1) } });
  assert.equal(box.summary().total, INBOX_LIMITS.total);
  now += INBOX_LIMITS.ageMs + 1;
  assert.equal(box.summary().total, 0);
  assert.equal(box.summary().dropped, 2351);
});

test('移除监听权限和切换 QQ 账号后不可读旧授权数据', () => {
  const box = new QQInbox();
  box.add('group:12345', { kind: 'message', event: message() }, 10001);
  box.add('private:23456', { kind: 'message', event: message() }, 10002);
  box.prune((address, self) => address === 'group:12345' && self === 10001);
  assert.equal(box.summary().total, 1);
  box.prune((_a, self) => self === 10002);
  assert.equal(box.summary().total, 0);
});
