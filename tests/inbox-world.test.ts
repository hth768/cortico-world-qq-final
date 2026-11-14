import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { QQWorld } from '../src/world.ts';
import { QQ_DEFAULTS } from '../src/config.ts';
import sharp from 'sharp';

// 可用同一组行为测试校验实际打包入口；仍只连接假宿主与假协议端。
const releaseRoot = process.env.QQ_FINAL_TEST_PACKAGE;
const releaseMain = releaseRoot ? JSON.parse(readFileSync(join(releaseRoot, 'package.json'), 'utf8')).main : null;
const releaseDefinition = releaseRoot
  ? (await import(pathToFileURL(join(releaseRoot, releaseMain)).href)).definition : null;

function fixture(t: TestContext, mode = 'active', patch = {}, packageDir = '') {
  const dir = mkdtempSync(join(tmpdir(), 'qq-inbox-world-'));
  const config = { ...structuredClone(QQ_DEFAULTS), receiveMode: mode, groups: [12345], privates: [23456], ...patch };
  const world: any = releaseDefinition
    ? releaseDefinition.create({ cfg: config, packageDir, dataDir: dir, secret: () => '' })
    : new QQWorld(config as any, packageDir, dir);
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
  const picture = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } }).png().toBuffer();
  f.world.fetchBytes = async () => { downloads++; return picture; };
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

test('手动收藏指定消息的第 N 张图片，与自动收藏去重、标注和发送共用同一库', async (t) => {
  const { StickerStore } = await import('../src/sticker.ts');
  const { existsSync, mkdirSync, writeFileSync } = await import('node:fs');
  const f = fixture(t, 'active', { imageTransport: 'base64', sendIntervalMs: 0 });
  const dir = f.world.dataDir;
  const storeDir = join(dir, '收藏夹');
  const store = new StickerStore(storeDir, { ...f.config.vision, enabled: false }, f.world.log, dir);
  f.world.stickers = store;
  f.world.stickerDirAbs = storeDir;
  f.world.emojiDirAbs = join(dir, 'legacy');
  mkdirSync(f.world.emojiDirAbs);
  writeFileSync(join(f.world.emojiDirAbs, 'legacy.gif'), 'GIF89a');
  f.config.sticker.enabled = false;
  const downloads: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    downloads.push(String(input));
    return new Response(Buffer.from('GIF89a'));
  });
  const media = [{ type: 'sticker', data: { url: 'https://cdn.example/a.gif' } }, { type: 'sticker', data: { url: 'https://cdn.example/b.gif' } }];
  await f.deliver(message(77, { message: media }));
  await f.call({ action: 'read', conversation: 'group:12345' });
  const invoke = (args: any) => f.world.tools().find((t: any) => t.name === 'qq_sticker').handler(args, {});
  const save = { action: 'save', message_id: 77, index: 2, conv: 'group:12345', label: '微笑' };
  await invoke({ ...save, conv: 'private:23456' });
  await invoke({ ...save, index: 3 });
  assert.equal(downloads.length, 0);
  assert.match(await invoke(save), /已收藏/);
  assert.deepEqual(downloads, ['https://cdn.example/b.gif']);
  const m = store.stats().recent[0];
  assert.equal(m.label, '微笑');
  const persisted = () => JSON.parse(readFileSync(join(dir, 'sticker-index.json'), 'utf8'));
  assert.equal(persisted()[m.hash].file, m.file);
  store.ingest('https://cdn.example/b.gif', 'group:12345', '');
  for (let n=0; n<50 && m.count < 2; n++) await new Promise(r => setTimeout(r, 5));
  assert.equal(m.count, 2);
  assert.equal(store.size, 1);
  const sent: any[] = [];
  f.world.driver.callApi = async (_: string, args: any) => { sent.push(...args.message); return {message_id: 456}; };
  await f.world.sendTo('private:23456', `[表情包:${m.file}]`);
  await f.world.sendTo('private:23456', '[表情包:legacy.gif]');
  assert.deepEqual(sent.map(s=>s.data.file), ['base64://R0lGODlh','base64://R0lGODlh']);
  const failure = await f.world.sendTo('private:23456', '看看[表情包:missing.gif]');
  assert.match(failure, /未发送/);
  assert.equal(sent.length, 2);
  await invoke({action:'delete',file:'../'+m.file});
  assert.equal(store.size, 1);
  assert.match(await invoke({action:'delete',file:m.file}), /已删除/);
  assert.equal(existsSync(join(storeDir, m.file)), false);
  assert.equal(store.size, 0);
  assert.deepEqual(persisted(), {});
});

test('跨天查收与聚合私聊：正文显示每条原消息的 ISO 时间及配置时区', async (t) => {
  const f = fixture(t, 'active', {timezone:'Asia/Shanghai'});
  const time = Date.parse('2026-11-06T23:59:59+08:00')/1000;
  await f.deliver(message(1, {time}));
  const read = await f.call({action:'read', conversation:'group:12345'});
  assert.match(read.text, /2026-11-06T23:59:59\.000\+08:00/);
  const p = fixture(t, 'passive', {timezone:'Asia/Shanghai', privateAggregationWindow: 100});
  for (let i=0;i<2;i++) await p.deliver(message(i+1,{time:time+i,message_type:'private',group_id:undefined}));
  await new Promise(r=>setTimeout(r,150));
  assert.equal(p.events.length, 1);
  assert.match(p.events[0].text,/2026-11-06T23:59:59\.000\+08:00[\s\S]+2026-11-07T00:00:00\.000\+08:00/);
});

test('空间显式附图全部有效才发布：不静默丢图，也不替换为最近图片', async (t) => {
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const f = fixture(t, 'active', { qzone: { ...QQ_DEFAULTS.qzone, enabled: true, imageMode: 'recent' } });
  const dir = join(f.world.dataDir, 'owned');
  f.world.imageDirAbs = dir;
  f.world.stickerDirAbs = dir;
  mkdirSync(dir);
  const bytes = Buffer.from('GIF89a');
  writeFileSync(join(dir,'cat.gif'), bytes);
  writeFileSync(join(dir,'fake.gif'), 'not image');
  writeFileSync(join(dir,'large.gif'), Buffer.alloc(8*1024*1024+1));
  const calls: string[][] = [];
  f.world.driver.callApi = async (action: string, params: any) => { assert.equal(action, 'send_qzone_msg'); calls.push(params.images); return null; };
  f.world.recentImages.push({url:'https://example.org/recent.png'});
  f.world.initQzone();
  const tool = f.world.tools().find((v: any) => v.name === 'qq_qzone');
  const post = (images?: unknown) => tool.handler({action:'post',content:'配图测试',images}, {});
  for (const bad of [null, 'cat.gif', [123], [join(dir,'cat.gif')], ['[图片:../cat.gif]'], ['[图片:missing]'], ['[图片:fake.gif]'], ['[图片:large.gif]'], ['https://example.org/ok','file:///bad'], ['base64://!!!']]) {
    assert.match(await post(bad), /失败/);
    assert.equal(calls.length,0);
  }
  const inline = 'base64://'+bytes.toString('base64'), data = 'data:image/gif;base64,'+bytes.toString('base64');
  await post(['[图片:cat.gif]', '[表情包:cat.gif]', inline, data]);
  await post([]);
  await post();
  assert.deepEqual(calls, [[inline,inline,inline,data],[],['https://example.org/recent.png']]);
});

test('运行中外部导入文件后 qq_file list 和 send 立即生效，保存保留外部条目', async (t) => {
  const { createHash } = await import('node:crypto');
  const { writeFileSync } = await import('node:fs');
  const f = fixture(t, 'active', { asr: { ...QQ_DEFAULTS.asr, mode: 'off' }, sendIntervalMs: 0 });
  const calls: any[] = [];
  f.world.createDriver = () => ({ start: async () => {}, stop: async () => {}, callApi: async (action: string, params: any) => {
    calls.push({ action, params });
    return {};
  } });
  await f.world.start(f.world.host);
  const store = f.world.files;
  store.saveBytes(Buffer.from('existing'), 'existing.txt');
  store.flush();
  const bytes = Buffer.from('new markdown document');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const file = `file-${hash.slice(0, 16)}.md`;
  const index = join(f.world.dataDir, 'file-index.json');
  const rows = JSON.parse(readFileSync(index, 'utf8'));
  rows.push({ hash, file, ext: '.md', name: 'new.md', size: bytes.length, label: '新增文档', tag: '', usage: '', count: 1, firstSaved: Date.now(), lastSaved: Date.now() });
  writeFileSync(join(f.world.fileDirAbs, file), bytes);
  writeFileSync(index, JSON.stringify(rows));
  const invoke = (args: any) => f.world.tools().find((tool: any) => tool.name === 'qq_file').handler(args, {});
  assert.ok((await invoke({ action: 'list' })).includes(file));
  for (const to of ['private:23456', 'group:12345']) {
    assert.match(await invoke({ action: 'send', file, to }), /发送文件/);
  }
  const uploads = calls.filter(call => call.action.startsWith('upload_'));
  assert.deepEqual(uploads.map(call => call.action), ['upload_private_file', 'upload_group_file']);
  assert.ok(uploads.every(call => call.params.file === join(f.world.fileDirAbs, file) && call.params.name === 'new.md'));
  store.flush();
  assert.equal(JSON.parse(readFileSync(index, 'utf8')).length, 2);
});

test('升级：新目录优先，只恢复本部署索引匹配的旧文件，缺图可重新收藏', async (t) => {
  const { createHash } = await import('node:crypto');
  const { mkdirSync, writeFileSync, existsSync } = await import('node:fs');
  const pkg = mkdtempSync(join(tmpdir(), 'qq-old-package-'));
  t.after(() => rmSync(pkg, {recursive:true,force:true}));
  const absoluteVideos = join(pkg,'custom-videos');
  const f = fixture(t,'active',{vision:{...QQ_DEFAULTS.vision, videoDir:absoluteVideos}, asr:{...QQ_DEFAULTS.asr,mode:'off'}, sendIntervalMs:0},pkg);
  const w = f.world, dir = w.dataDir;
  const current = Buffer.from('GIF89a-current'), previous = Buffer.from('GIF89a-legacy'), lost = Buffer.from('GIF89a-missing');
  const meta = (kind: string, bytes: Buffer) => {
    const hash=createHash('sha256').update(bytes).digest('hex');
    return {hash,file:`${kind}-${hash.slice(0,16)}.gif`,ext:'.gif',size:bytes.length,label:'保留标注',count:1,sources:[],emotion:'开心',lastSeen:1};
  };
  for (const [kind,folder] of [['sticker','emoji'],['image','images'],['file','files']]) {
    for (const base of [dir,pkg]) mkdirSync(join(base,folder),{recursive:true});
    const [a,b,c]=[current,previous,lost].map(bytes=>meta(kind,bytes));
    writeFileSync(join(dir,folder,a.file),current);
    writeFileSync(join(pkg,folder,a.file),'wrong');
    writeFileSync(join(pkg,folder,b.file),previous);
    writeFileSync(join(pkg,folder,c.file),'wrong hash');
    writeFileSync(join(pkg,folder,'unindexed.gif'),previous);
    writeFileSync(join(dir,kind+'-index.json'),JSON.stringify(kind==='file'?[a,b,c]:Object.fromEntries([a,b,c].map(m=>[m.hash,m]))));
  }
  w.createDriver=()=>({start:async()=>{},stop:async()=>{},callApi:async()=>({message_id:123})});
  await w.start(w.host);
  assert.equal(w.videoDirAbs,absoluteVideos);
  for(const [kind,folder,store] of [['sticker','emoji',w.stickers],['image','images',w.images],['file','files',w.files]]){
    assert.equal(store.size,2);
    assert.deepEqual(readFileSync(join(dir,folder,meta(kind,current).file)),current);
    assert.deepEqual(readFileSync(join(dir,folder,meta(kind,previous).file)),previous);
    assert.ok(existsSync(join(pkg,folder,meta(kind,previous).file)));
    assert.ok(!existsSync(join(dir,folder,meta(kind,lost).file)));
    assert.ok(!existsSync(join(dir,folder,'unindexed.gif')));
  }
  assert.ok(w.files.resolve(meta('file',previous).file));
  const m=meta('sticker',lost);
  const result=await w.sendTo('private:23456',`[表情包:${m.file}]`);
  assert.match(result,/未发送/); assert.ok(result.includes(m.file));
  w.stickers.fetchBytes=async()=>lost;
  assert.equal((await w.stickers.saveOne('https://example.org/lost.gif','private:23456',{})).label,'保留标注');
  assert.equal(w.stickers.stats().total,3);
  assert.match(await w.sendTo('private:23456',`[表情包:${m.file}]`),/发送 1\/1/);
  const sent: any[] = [];
  w.driver.callApi=async (_: string,args: any)=>{sent.push(...args.message);return {message_id:111};};
  await w.sendTo('private:23456','字面示例：\\[图片:missing.gif]');
  assert.equal(sent[0].data.text,'字面示例：[图片:missing.gif]');
});


test('未读 newest 返回最新一页且报告跳过范围，失败保留旧积压，clear 不返回正文', async (t) => {
  const f = fixture(t);
  for (let id = 1; id <= 8; id++) await f.deliver(message(id));
  f.fail(true);
  assert.equal((await f.call({action:'read', conversation:'group:12345', limit:2, order:'newest'})).failed, true);
  assert.equal(JSON.parse(await f.call({action:'peek'})).total, 8);
  f.fail(false);
  const result = await f.call({action:'read', conversation:'group:12345', limit:2, order:'newest'});
  const receipt = JSON.parse(result.text.split('\n')[0]);
  assert.equal(receipt.read, 2);
  assert.equal(receipt.skipped, 6);
  assert.equal(receipt.remaining, 0);
  assert.ok(result.text.indexOf('外部正文-7') < result.text.indexOf('外部正文-8'));
  assert.doesNotMatch(result.text, /外部正文-1/);
  await f.deliver(message(9));
  const count = f.events.length;
  assert.equal((await f.call({action:'clear'})).failed, true);
  const cleared = await f.call({action:'clear', conversation:'all'});
  assert.equal(JSON.parse(cleared).cleared, 1);
  assert.doesNotMatch(cleared, /外部正文/);
  assert.equal(f.events.length, count);
});

test('混合模式关键词、引用自己与差集补齐；主动模式仍只入箱', async (t) => {
  const f = fixture(t, 'hybrid', {triggerKeywords:['鱼宝', '('], replyWake:true, historyBackfillLimit:2});
  for (let id=1; id<=3; id++) await f.deliver(message(id));
  await f.deliver(message(4, {message:[{type:'text',data:{text:'鱼宝你好'}}]}));
  assert.equal(f.events.length,1);
  assert.match(f.events[0].text,/外部正文-2/);
  assert.match(f.events[0].text,/更早 1 条已省略/);
  await f.deliver(message(5, {message:[{type:'text',data:{text:'('}}]}));
  assert.doesNotMatch(f.events[1].text,/外部正文-2|鱼宝你好/);
  f.world.rememberSentMessage('group:12345',{message_id:90});
  f.world.saveState();
  f.world.knownMessages.clear();
  f.world.loadState();
  await f.deliver(message(6,{message:[{type:'reply',data:{id:90}},{type:'text',data:{text:'引用回应'}}]}));
  assert.equal(f.events.length,3);
  f.config.receiveMode='active';
  await f.deliver(message(7,{message:[{type:'text',data:{text:'鱼宝'}}]}));
  assert.equal(f.events.length,3);
});

test('群输入节流合并到一次事件，clear 会取消待投递；私聊实时', async (t) => {
  const f=fixture(t,'passive',{inputMinIntervalSec:0.08,inputMaxMessagesPerWindow:3});
  await f.deliver(message(1));
  await f.deliver(message(2));
  await f.deliver(message(3));
  assert.equal(f.events.length,1);
  await f.deliver(message(4,{message_type:'private',group_id:undefined}));
  assert.equal(f.events.length,2);
  await new Promise(r=>setTimeout(r,120));
  await f.world.msgChain;
  assert.equal(f.events.length,3);
  assert.match(f.events[2].text,/外部正文-2/);
  assert.match(f.events[2].text,/外部正文-3/);
  await f.deliver(message(5));
  await f.call({action:'clear',conversation:'group:12345'});
  await new Promise(r=>setTimeout(r,120));
  await f.world.msgChain;
  assert.equal(f.events.length,3);
});

test('长图分段为合法 JPEG，引用图片也走相同处理', async (t) => {
  const f=fixture(t,'passive');
  const bytes=await sharp({create:{width:1880,height:8805,channels:3,background:'white'}}).png().toBuffer();
  f.world.fetchBytes=async()=>bytes;
  await f.deliver(message(1,{message:[{type:'image',data:{url:'https://example.com/long.png'}}]}));
  assert.equal(f.events[0].blobs.length,4);
  for(const blob of f.events[0].blobs){
    const meta=await sharp(blob.bytes).metadata();
    assert.equal(meta.format,'jpeg');
    assert.ok(meta.width!<=2048 && meta.height!<=2048);
    assert.equal(blob.mime,'image/jpeg');
  }
  f.world.driver.callApi=async()=>({sender:{user_id:23456},message:[{type:'image',data:{url:'https://example.com/long.png'}}]});
  assert.equal((await f.world.resolveQuoted(1)).blobs.length,4);
});

test('本地 QQ 收藏接受路径和 result=0，失败回退 base64 并清理临时文件', async (t) => {
  const {existsSync}=await import('node:fs');
  const f=fixture(t,'active',{imageTransport:'path',sticker:{...QQ_DEFAULTS.sticker,addToQQFavorites:true}});
  const files:string[]=[];
  f.world.driver.callApi=async (_:string,p:any)=>{files.push(p.file); assert.ok(existsSync(p.file)); return {result:0,isExist:0};};
  assert.equal(await f.world.pushStickerToQQFavorites(Buffer.from('GIF89a'),'.gif'),'protocol-confirmed');
  assert.equal(existsSync(files[0]),false);
  f.world.driver.callApi=async (_:string,p:any)=>{files.push(p.file); if(!p.file.startsWith('base64://')) throw Error('path unavailable'); return {emoji_id:'42'};};
  assert.equal(await f.world.pushStickerToQQFavorites(Buffer.from('GIF89a'),'.gif'),'42');
  assert.equal(existsSync(files[1]),false);
  assert.ok(files[2].startsWith('base64://'));
});

test('合并转发截断提供总数与省略提示', async (t) => {
  const f=fixture(t,'passive');
  f.world.driver.getForwardMessages=async()=>Object.assign([{sender:{user_id:23456,nickname:'用户'},message:[{type:'text',data:{text:'转发正文'}}]}],{total:25});
  await f.deliver(message(1,{message:[{type:'forward',data:{id:'f'}}]}));
  const forward=f.events.find(e=>e.type==='qq.forward');
  assert.equal(forward.meta.total,25);
  assert.equal(forward.meta.truncated,true);
  assert.match(forward.text,/另有 24 条未展开/);
});

test('PR22 拆句保留 at 与 markdown 正文可读', async () => {
  const {splitReplyIntoMessages,renderIncoming,renderSegmentsPlain}=await import('../src/normalize.ts');
  const groups=splitReplyIntoMessages([{type:'at',data:{qq:23456}},{type:'text',data:{text:'第一句。\n第二句。'}}],{splitBySentence:true,sentencesPerMessage:1,maxBytes:1500});
  assert.equal(groups[0][0].type,'at');
  assert.equal(groups.flat().filter(s=>s.type==='at').length,1);
  const segments=[{type:'markdown',data:{content:'## **欢迎**\n[@用户](mqqapi://mention)\n![图片](https://example.com/a.png)'}}];
  assert.match(renderIncoming(segments,{timezone:'Asia/Shanghai',selfId:1}),/欢迎\n@用户\n\[图片\]/);
  assert.doesNotMatch(renderSegmentsPlain(segments),/mqqapi/);
});

test('断档补回遵循主动与混合接收模式，关闭或停用后不再处理', async (t) => {
  const f=fixture(t,'active');
  await f.world.deliverRecovered('private:23456',message(100,{message_type:'private',group_id:undefined}),false);
  assert.equal(f.events.length,0);
  assert.equal(JSON.parse(await f.call({action:'peek'})).total,1);
  f.config.receiveMode='hybrid';
  await f.world.deliverRecovered('group:12345',message(101),false);
  assert.equal(f.events.length,0);
  await f.world.deliverRecovered('private:23456',message(102,{message_type:'private',group_id:undefined}),false);
  assert.equal(f.events.length,1);
  f.config.gapRecovery.enabled=false;
  await f.world.deliverRecovered('private:23456',message(103,{message_type:'private',group_id:undefined}),false);
  assert.equal(f.events.length,1);
});


test('实际 qq_send 拆句后 atPosition=tail 把 @ 放在末条文字末尾', async (t) => {
  const f=fixture(t,'passive',{atPosition:'tail',sendIntervalMs:0});
  const sent:any[]=[];
  f.world.driver.callApi=async (_:string,args:any)=>{sent.push(args.message);return {message_id:sent.length};};
  const tool=f.world.tools().find((tool:any)=>tool.name==='qq_send');
  await tool.handler({to:'group:12345',text:'第一句。第二句。',at:['23456']},{});
  assert.equal(sent.length,2);
  assert.equal(sent[1].at(-1).type,'at');
  assert.equal(sent.flat().filter((s:any)=>s.type==='at').length,1);
});
