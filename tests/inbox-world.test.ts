import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { QQWorld } from '../src/world.ts';
import { QQ_DEFAULTS } from '../src/config.ts';

// 可用同一组行为测试校验实际打包入口；仍只连接假宿主与假协议端。
const releaseRoot = process.env.QQ_FINAL_TEST_PACKAGE;
const releaseMain = releaseRoot ? JSON.parse(readFileSync(join(releaseRoot, 'package.json'), 'utf8')).main : null;
const releaseDefinition = releaseRoot
  ? (await import(pathToFileURL(join(releaseRoot, releaseMain)).href)).definition : null;

function fixture(t: TestContext, mode = 'active', patch = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'qq-inbox-world-'));
  const config = { ...structuredClone(QQ_DEFAULTS), receiveMode: mode, groups: [12345], privates: [23456], ...patch };
  const world: any = releaseDefinition
    ? releaseDefinition.create({ cfg: config, packageDir: '', dataDir: dir, secret: () => '' })
    : new QQWorld(config as any, '', dir);
  const events: any[] = [];
  const log: any = { info() {}, warn() {}, error() {}, debug() {}, child: () => log };
  let fail = false;
  world.log = log;
  world.identity = { selfId: 10001, nickname: '本机bot', groups: new Map([[12345, '测试群']]), friends: new Map(), knownPeers: new Map() };
  world.driver = { stop: async () => {}, getMemberInfo: async () => null, getForwardMessages: async () => [
    { sender: { nickname: '转发者', user_id: 23456 }, content: [{ type: 'text', data: { text: '转发正文' } }] },
  ] };
  world.host = { log, isPaused: () => false, modelFacts: { accepts: () => true },
    pushEvent: async (e: any, opts: any) => {
      if (fail) throw new Error('fake storage failure');
      events.push({ ...e, opts });
      return { ...e, cursor: events.length };
    } };
  t.after(async () => { await world.stop(); rmSync(dir, { recursive: true, force: true }); });
  const call = (args: any) => world.tools().find((tool: any) => tool.name === 'qq_inbox').handler(args, {});
  const deliver = async (event: any) => { world.handleEvent(event); await world.msgChain; };
  const wakes = () => events.filter((e) => e.opts?.deliver !== false && e.opts?.trigger !== 'piggyback');
  return { world, events, call, deliver, wakes, config, fail: (v: boolean) => { fail = v; } };
}

function message(id = 1, patch = {}) {
  return { post_type: 'message', message_type: 'group', self_id: 10001, group_id: 12345, user_id: 23456,
    sender: { nickname: '用户昵称', role: 'member' }, time: 1730000000, message_id: id,
    message: [{ type: 'text', data: { text: `外部正文-${id}` } }], ...patch };
}
const textOf = (result: any) => typeof result === 'string' ? result : result.text;

test('100 条消息、私聊、@和通知均不唤醒；peek 不泄露正文；默认一次只读5条', async (t) => {
  const f = fixture(t);
  for (let id = 1; id <= 100; id++) await f.deliver(message(id));
  await f.deliver(message(101, { message_type: 'private', group_id: undefined }));
  await f.deliver(message(102, { message: [{ type: 'at', data: { qq: '10001' } }, { type: 'text', data: { text: '请看我' } }] }));
  await f.deliver(message(103, { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 10001 }));
  await f.deliver(message(104, { group_id: 99999 }));
  await f.deliver(message(1)); // 重投去重
  assert.equal(f.events.length, 0);
  const peek = await f.call({ action: 'peek' });
  assert.equal(JSON.parse(peek).total, 103);
  assert.doesNotMatch(peek, /外部正文|用户昵称|请看我/);
  assert.doesNotMatch(f.world.envPromptVars()['qq.unread'], /外部正文|用户昵称/);
  const read = await f.call({ action: 'read', conversation: 'group:12345' });
  assert.match(read.text, /"read":5/);
  assert.match(read.text, /外部正文-5/);
  assert.doesNotMatch(read.text, /外部正文-6/);
  assert.match(read.text, /外部资料/);
  assert.equal(f.wakes().length, 0);
  assert.equal(f.events.length, 5);
  assert.ok(f.events.every((e) => e.origin === 'external' && e.opts.deliver === false));
  assert.equal(f.events[0].meta.conv, 'group:12345');
  assert.equal(f.events[0].meta.user, 23456);
  assert.equal(Date.parse(f.events[0].ts), 1730000000000);
  assert.equal(f.world._pendingReplyConvs.size, 0);
  assert.equal(JSON.parse(await f.call({ action: 'peek' })).total, 98);
});

test('主动私聊绕过自动聚合定时器；两次并行读取不重复消费', async (t) => {
  const f = fixture(t, 'active', { privateAggregationWindow: 20_000 });
  for (let n = 1; n <= 4; n++) await f.deliver(message(n, { message_type: 'private', group_id: undefined }));
  const results = await Promise.all([f.call({ action: 'read', conversation: 'private:23456', limit: 2 }), f.call({ action: 'read', conversation: 'private:23456', limit: 2 })]);
  assert.match(results[0].text, /外部正文-1/);
  assert.doesNotMatch(results[1].text, /外部正文-1/);
  assert.match(results[1].text, /外部正文-4/);
  assert.equal(f.world.convs.get('private:23456').aggregationTimer, undefined);
  assert.equal(f.wakes().length, 0);
});

test('长消息不会被资料包装静默截断，超大批次提前分页且保留余下未读', async (t) => {
  const f = fixture(t);
  for (let n = 1; n <= 4; n++) await f.deliver(message(n, { message: 'x'.repeat(30000) + `END-${n}` }));
  const read = await f.call({ action: 'read', conversation: 'group:12345', limit: 20 });
  assert.match(read.text, /"read":2,"remaining":2/);
  assert.match(read.text, /END-1/);
  assert.match(read.text, /END-2/);
  assert.doesNotMatch(read.text, /END-3/);
  assert.equal(f.wakes().length, 0);
});

test('延迟处理图片和转发，读取时返回附件和原文，无后续唤醒', async (t) => {
  const f = fixture(t);
  let downloads = 0;
  f.world.fetchBytes = async () => { downloads++; return new Uint8Array([1, 2, 3]); };
  await f.deliver(message(1, { message: [{ type: 'image', data: { file: 'image.jpg', url: 'https://example.com/image.jpg' } }] }));
  await f.deliver(message(2, { message: [{ type: 'forward', data: { id: 'forward1' } }] }));
  assert.equal(downloads, 0);
  const result = await f.call({ action: 'read', conversation: 'group:12345' });
  assert.equal(downloads, 1);
  assert.equal(result.blobs.length, 1);
  assert.match(result.text, /转发正文/);
  assert.equal(f.wakes().length, 0);
});

test('读取落库失败保留未读，恢复后可以重试；非法数量或会话被拒绝', async (t) => {
  const f = fixture(t);
  await f.deliver(message());
  f.fail(true);
  const failed = await f.call({ action: 'read', conversation: 'group:12345' });
  assert.equal(failed.failed, true);
  assert.equal(JSON.parse(await f.call({ action: 'peek' })).total, 1);
  f.fail(false);
  assert.match(textOf(await f.call({ action: 'read', conversation: 'group:12345' })), /"read":1/);
  for (const limit of [0, 21, NaN, 1.5, '5']) assert.equal((await f.call({ action: 'read', conversation: 'group:12345', limit })).failed, true);
  assert.equal((await f.call({ action: 'read', conversation: 'group:99999' })).failed, true);
});

test('单次查收提醒只含数量，无默认计时、无空箱唤醒、不重复提醒', async (t) => {
  const f = fixture(t);
  await f.deliver(message());
  await f.world.checkInboxReminder();
  assert.equal(f.events.length, 0);
  assert.equal((await f.call({ action: 'plan_check', minutes: 1 })).failed, true);
  await f.call({ action: 'plan_check', minutes: 5 });
  f.world.inbox.plan(Date.now() - 1);
  await f.world.checkInboxReminder();
  await f.world.checkInboxReminder();
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'qq.inbox-check');
  assert.equal(f.events[0].origin, 'internal');
  assert.doesNotMatch(JSON.stringify(f.events), /外部正文|用户昵称/);
  await f.call({ action: 'read', conversation: 'group:12345' });
  f.world.inbox.plan(Date.now() - 1);
  await f.world.checkInboxReminder();
  assert.equal(f.wakes().length, 1);
  assert.equal(f.world.inbox.checkAt, null);
  await f.call({ action: 'plan_check', minutes: 5 });
  await f.call({ action: 'cancel_check' });
  assert.equal(f.world.inbox.checkAt, null);
});

test('默认混合模式仅私聊/@自己/戳自己唤醒，显式被动模式维持原消息投递', async (t) => {
  const hybrid = fixture(t, undefined, { receiveMode: undefined });
  assert.equal(hybrid.config.receiveMode, 'hybrid');
  await hybrid.deliver(message(1));
  assert.equal(hybrid.wakes().length, 0);
  await hybrid.deliver(message(2, { message_type: 'private' }));
  await hybrid.deliver(message(3, { message: [{ type: 'at', data: { qq: 10001 } }] }));
  await hybrid.deliver(message(4, { post_type: 'notice', notice_type: 'notify', sub_type: 'poke', target_id: 10001 }));
  assert.equal(hybrid.wakes().length, 3);
  assert.equal(JSON.parse(await hybrid.call({ action: 'peek' })).total, 1);
  const passive = fixture(t, 'passive');
  await passive.deliver(message(1));
  assert.equal(passive.wakes().length, 1);
  assert.equal(JSON.parse(await passive.call({ action: 'peek' })).total, 0);
});

test('空间评论和自动回复保持安静；随机主动聊天定时器在主动模式下不启动', async (t) => {
  const f = fixture(t, 'active', { qzone: { ...structuredClone(QQ_DEFAULTS.qzone), enabled: true,
    commentAction: 'auto', autoReplyComments: { enabled: true, cooldownSec: 0, dailyQuota: 10 } } });
  f.world.initQzone();
  f.world.initProactive();
  assert.equal(f.world.proactive.timer, undefined);
  f.world.qzone.onEvent({ type: 'qq.message.comment.new', data: { tid: 'p1', commentId: 'c1', operatorNick: '外部昵称', text: '外部评论' } });
  await f.world.qzone.tick();
  assert.equal(f.events.length, 0);
  assert.equal(JSON.parse(await f.call({ action: 'peek' })).total, 1);
  const read = await f.call({ action: 'read', conversation: 'qzone' });
  assert.match(read.text, /外部评论/);
  assert.equal(f.wakes().length, 0);
});

test('撤销监听后不可读取，切换账号后不串号，切换被动模式不会自动倒出积压', async (t) => {
  const f = fixture(t);
  await f.deliver(message(1));
  f.config.receiveMode = 'passive';
  assert.equal(JSON.parse(await f.call({ action: 'peek' })).total, 1);
  assert.equal(f.events.length, 0);
  f.config.groups = [];
  assert.equal(JSON.parse(await f.call({ action: 'peek' })).total, 0);
  f.config.groups = [12345]; f.config.receiveMode = 'active';
  await f.deliver(message(2));
  f.world.identity.selfId = 10002;
  assert.equal(JSON.parse(await f.call({ action: 'peek' })).total, 0);
});

test('视频 file URL 进入时间轴处理，附件随主动查收返回；失败明确可见', async (t) => {
  const f = fixture(t);
  f.config.vision.videoEnabled = true;
  const urls: string[] = [];
  f.world.videos = { saveAndExtractTimeline: async (url: string) => {
    urls.push(url);
    return { file: 'video-123.mp4', segments: [{ index: 0, startSec: 0, endSec: 8, frameBytes: new Uint8Array([1]), audioBytes: null }] };
  } };
  await f.deliver(message(1, { message: [{ type: 'video', data: { file: 'https://example.com/v.mp4' } }] }));
  const result = await f.call({ action: 'read', conversation: 'group:12345' });
  assert.deepEqual(urls, ['https://example.com/v.mp4']);
  assert.equal(result.blobs.length, 1);
  assert.match(result.text, /视频片段.*0:00-0:08/);
  f.world.videos.saveAndExtractTimeline = async () => null;
  await f.deliver(message(2, { message: [{ type: 'video', data: { url: 'https://example.com/v.mp4' } }] }));
  assert.match((await f.call({ action: 'read', conversation: 'group:12345' })).text, /视频下载失败/);
  await f.deliver(message(3, { message: [{ type: 'video', data: { file: 'C:\\secret.mp4' } }] }));
  assert.match((await f.call({ action: 'read', conversation: 'group:12345' })).text, /未提供可用的公开下载地址/);
});

test('多个文件部分失败不串位，正文中的文件占位文本保持原样', async (t) => {
  const f = fixture(t);
  f.world.saveIncomingFile = async (_ev: any, data: any) => data.file === 'good'
    ? { file: 'file-0123456789abcdef.pdf', size: 1 } : null;
  await f.deliver(message(1, { message: [
    { type: 'text', data: { text: '原文[文件] A:' } },
    { type: 'file', data: { file: 'bad' } },
    { type: 'text', data: { text: ' B:' } },
    { type: 'file', data: { file: 'good' } },
  ] }));
  const result = await f.call({ action: 'read', conversation: 'group:12345' });
  assert.match(result.text, /原文\[文件\] A:\[文件未保存/);
  assert.match(result.text, /B:\[文件:file-0123456789abcdef.pdf\]/);
  assert.deepEqual(f.events[0].meta.fileFiles, ['file-0123456789abcdef.pdf']);
});

test('群和私聊文件直链失效后通过文件 ID 刷新，群 busid 保留', async (t) => {
  const f = fixture(t);
  const calls: any[] = [];
  const downloads: string[] = [];
  f.world.driver.callApi = async (action: string, params: any) => {
    calls.push({ action, params }); return { url: 'https://example.com/fresh' };
  };
  f.world.files = { flush() {}, saveUrl: async (url: string) => {
    downloads.push(url);
    return url.endsWith('/old') ? { ok: false } : { ok: true, meta: { file: 'file-0123456789abcdef.pdf' } };
  } };
  for (const group of [true, false]) {
    const ev = message(1, { group_id: group ? 12345 : undefined, message_type: group ? 'group' : 'private' });
    assert.ok(await f.world.saveIncomingFile(ev, { file_id: 'id1', busid: 0, url: 'https://example.com/old', name: 'a.pdf' }));
  }
  assert.deepEqual(downloads, ['https://example.com/old', 'https://example.com/fresh', 'https://example.com/old', 'https://example.com/fresh']);
  assert.equal(calls[0].action, 'get_group_file_url');
  assert.deepEqual(calls[0].params, { group_id: 12345, file_id: 'id1', busid: 0 });
  assert.equal(calls[1].action, 'get_private_file_url');
  assert.equal(calls[1].params.user_id, 23456);
});

test('文件上传通知下载失败不再误报为协议未提供地址', async (t) => {
  const f = fixture(t);
  f.world.saveIncomingFile = async () => null;
  await f.deliver(message(1, { post_type: 'notice', notice_type: 'group_upload', file: { id: 'id1', url: 'https://example.com/file' } }));
  const result = await f.call({ action: 'read', conversation: 'group:12345' });
  assert.match(result.text, /下载\/保存失败/);
});
