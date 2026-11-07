import assert from 'node:assert/strict';
import test from 'node:test';

// 安全回归：这几条一旦被改回去，就是可被群友/提示词注入触发的漏洞。
// 认证评审（Pal-AI-Lab/cortico-extensions#104）明确要求修掉，故固化成测试。

import { QQ_DEFAULTS, toIds } from '../src/config.ts';
import { fetchQqVoiceBytes } from '../src/voice.ts';

test('反向监听默认只绑回环，不对外暴露', () => {
  assert.equal(QQ_DEFAULTS.wsHost, '127.0.0.1', '默认必须是回环地址');
  assert.notEqual(QQ_DEFAULTS.wsHost, '0.0.0.0', '默认不得监听所有网卡');
});

test('默认不提供空 token 的对外监听', () => {
  assert.equal(QQ_DEFAULTS.mode, 'reverse');
  assert.equal(QQ_DEFAULTS.wsHost, '127.0.0.1');
});

test('表情包文件名解析不得逃出表情包目录', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const src = fs.readFileSync(new URL('../src/normalize.ts', import.meta.url), 'utf8');

  // normalize.ts 依赖框架包 cortico（独立 clone 里未安装），无法直接 import；
  // 这里只抽取 resolveEmojiFile 函数体，注入它依赖的 node:path/fs 后单独验证。
  const start = src.indexOf('function resolveEmojiFile');
  assert.ok(start > 0, '必须存在 resolveEmojiFile');
  // 用花括号配平截取完整函数体（函数内有嵌套的 try/catch，不能按 '\n}\n' 截）
  let depth = 0;
  let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  assert.ok(end > 0, '函数体括号配平失败');
  const body = src.slice(start, end);
  assert.ok(body.startsWith('function resolveEmojiFile'), '抽取失败');
  // 去掉 TS 类型注解，得到可执行的纯 JS 函数体
  const js = body
    .replace(/function resolveEmojiFile\([^)]*\):\s*[^{]+\{/, 'function resolveEmojiFile(emojiDir, fname) {')
    .replace(/\(n:\s*number\)\s*=>/g, '(n) =>')
    .replace(/\(seg:\s*string\)\s*=>/g, '(seg) =>')
    .replace(/: number\[\]\s*=>/g, ' =>')
    .replace(/\):\s*string \| null\s*\{/g, ') {');
  assert.ok(!js.includes(': string'), 'TS 注解未清理干净');

  const factory = new Function(
    'isAbsolute', 'join', 'relative', 'resolve', 'sep', 'realpathSync', 'existsSync', 'statSync',
    `${js}\nreturn resolveEmojiFile;`,
  );
  const R = factory(
    path.isAbsolute,
    path.join,
    path.relative,
    path.resolve,
    path.sep,
    fs.realpathSync,
    fs.existsSync,
    fs.statSync,
  ) as (dir: string, file: string) => string | null;

  // 用真实的临时目录验证放行行为
  const os = await import('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-sec-'));
  const base = path.join(root, 'emojis');
  fs.mkdirSync(path.join(base, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(base, 'cat.jpg'), 'x');
  fs.writeFileSync(path.join(base, 'sub', 'dog.png'), 'x');
  fs.writeFileSync(path.join(base, 'sticker.gif'), 'x');
  fs.writeFileSync(path.join(root, 'secret.txt'), 'x');

  assert.ok(R(base, 'cat.jpg'), '普通文件名应放行');
  assert.ok(R(base, path.join('sub', 'dog.png')), '子目录应放行');
  assert.equal(R(base, 'cat'), path.join(base, 'cat.jpg'), '省略扩展名应补全到实际图片');
  assert.equal(R(base, 'sticker.jpg'), path.join(base, 'sticker.gif'), '错误扩展名应替换为实际图片');

  assert.equal(R(base, path.join('..', 'secret.txt')), null, '不得逃出目录');
  assert.equal(R(base, '..' + path.sep + '..' + path.sep + 'Windows' + path.sep + 'win.ini'), null);
  assert.equal(R(base, '..'), null);
  assert.equal(R(base, path.join(root, 'secret.txt')), null, '绝对路径应拒绝');
  assert.equal(R(base, 'nope.jpg'), null, '不存在的文件应拒绝');
  assert.equal(R(base, ''), null);
  assert.equal(R(base, 'a\0b'), null);

  // 目录内符号链接指向目录外 → 必须拒绝
  try {
    fs.symlinkSync(path.join(root, 'secret.txt'), path.join(base, 'leak.jpg'));
    assert.equal(R(base, 'leak.jpg'), null, '符号链接逃逸必须拒绝');
  } catch {
    /* Windows 创建符号链接可能失败，跳过该项 */
  }

  fs.rmSync(root, { recursive: true, force: true });
});

test('QQ空间附图只接受 http(s) 与 base64，拒绝 file://', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/qzone.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('isPublicImageUrl'), '应经过公开地址校验');
  assert.ok(src.includes('localhost') && src.includes('192 && b === 168'), '应拒绝本机和常见私网地址');
  assert.ok(src.includes('base64:\\/\\/'), '应允许 base64://');
  assert.ok(!/images[^\n]*file:\/\//.test(src), '不应再把 file:// 当作受支持的附图协议');
});

test('反向连接拒绝无鉴权的对外监听', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/driver.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('assertReverseListenerIsSafe'), '必须有对外监听的安全闸');
  assert.ok(src.includes('拒绝启动'), '无 token 且对外监听时应拒绝启动');
});

test('反向 WS 端口冲突不应让宿主 core 退出', async () => {
  const fs = await import('node:fs');
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  assert.ok(/try\s*\{\s*await this\.driver\.start\(\);\s*\}\s*catch/.test(world), 'World 启动连接必须捕获监听失败');
  assert.ok(world.includes('QQ 连接启动失败，World 将继续运行'), '端口冲突时应保留 World 而不是退出宿主');
});

test('反向服务端必须接受 OneBot 标准的 Authorization: Bearer 头', async () => {
  // 回归：早期实现只从 query 读 token（?access_token= / ?token=），
  // 而 OneBot v11 的约定是请求头 Authorization: Bearer <token>
  // （框架内置 qq world 也是这么发的，见 src/worlds/qq/driver.ts）。
  // NapCat 默认走请求头 → 只读 query 会永远判为「Token 不匹配」，
  // 表现为 NapCat 反复重连、桌宠一直「未连接」，且日志里看不出原因。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/driver.ts', import.meta.url), 'utf8');

  assert.ok(src.includes('extractToken'), '必须有统一的 extractToken');
  assert.ok(
    /authorization/i.test(src),
    '必须读取 authorization 请求头（OneBot v11 标准鉴权方式）',
  );
  assert.ok(/Bearer/i.test(src), '必须解析 Bearer 前缀');

  // query 方式仍需兼容（NapCat 侧手填地址，用法不统一）
  assert.ok(src.includes('access_token'), '仍应兼容 ?access_token=');
  assert.ok(src.includes("query.get('token')"), '仍应兼容 ?token=');
});

test('日志不回显实际 token 值', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/driver.ts', import.meta.url), 'utf8');
  assert.ok(
    /presented:\s*Boolean\(token\)/.test(src),
    '拒绝日志只应记录是否带了 token，不应回显其值',
  );
});

test('不得自行探测主模型 / 不得自行扫描 providers 下的 .env', async () => {
  // 认证评审（#104）：密钥必须走框架 WorldContext.secret()（部署 .env，按部署隔离）。
  // 曾经这里按目录层级读部署 config.json 与 providers/*/config.json 来「跟随主模型」，
  // 既绕开框架安全措施，又有把主模型密钥发到用户所填地址的隐患；自复制的 .env 正则
  // 还踩过「NAME= 留空读到下一行」的坑（Cortico#268）。这些一律不允许再出现。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url));

  assert.ok(!src.includes('detectActiveProvider'), '不得再自行探测 activeProvider');
  assert.ok(!src.includes('autoApiKey'), '不得缓存主模型密钥');
  assert.ok(
    !/dirname\(dirname\(this\.dataDir\)\)/.test(src),
    '不得按目录层级推算部署配置/providers 路径',
  );
  assert.ok(
    !/readFileSync\(envPath/.test(src) && !/readdirSync\(providersDir/.test(src),
    '不得自行读取 providers/*/.env',
  );
  // 密钥解析必须收敛到注入的框架 secret() 读取器
  assert.ok(
    /this\.secretResolver\?\.\(n\)/.test(src),
    '密钥必须经框架注入的 secretResolver（WorldContext.secret）',
  );
});

test('辅助模型三项配置缺一不可（不再跟随主模型密钥）', async () => {
  // 认证评审（#104）：辅助模型让用户填地址/模型名/密钥名，密钥用 ctx.secret() 读。
  // 曾经的「任一项留空即从主模型取」已移除：缺配置必须明确失败，不能借用别的密钥。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');

  const i = src.indexOf('private resolveHelperModel');
  assert.ok(i > 0, '必须存在 resolveHelperModel');
  const body = src.slice(i, src.indexOf('\n  }\n', i));

  assert.ok(/const missing: string\[\] = \[\]/.test(body), '必须逐项检查缺失');
  assert.ok(/if \(missing\.length\)/.test(body), '有缺失必须返回失败');
  assert.ok(!/autoEndpoint/.test(body), '不得再回退到主模型地址');
  assert.ok(!/autoApiKey/.test(body), '不得再回退到主模型密钥');
  assert.ok(!/autoModel/.test(body), '不得再回退到主模型模型名');
});

test('反向连接自动生成并持久化 token', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('ensureReverseToken'), '必须有 ensureReverseToken');
  assert.ok(src.includes('reverse-token.txt'), 'token 需持久化以跨重启稳定');
  assert.ok(src.includes('randomBytes'), 'token 必须随机生成，不可预测');
});

test('token 必须在 start() 里就备好，不能只挂在建连接时', async () => {
  // 回归：0.3.0~0.3.1 只在 createDriver() 里生成 token，而面板/工具在 start 之后、
  // driver 建立之前也可能读 token，那段时间读到的是空串 → 用户以为没生成。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');

  const startAt = src.indexOf('async start(host: WorldHost)');
  assert.ok(startAt > 0, '必须存在 start()');
  // 取start() 开头到第一个 driver.start() 之前的片段
  const head = src.slice(startAt, src.indexOf('this.driver.start()', startAt));
  assert.ok(
    head.includes('ensureReverseToken'),
    'start() 里必须无条件调用 ensureReverseToken()，不能依赖 createDriver',
  );
});

test('toIds 只收正整数（回归：空串曾被解析成 [0]）', () => {
  assert.deepEqual(toIds(''), []);
  assert.deepEqual(toIds('   '), []);
  assert.deepEqual(toIds([0]), []);
  assert.deepEqual(toIds('123,456'), [123, 456]);
});

test('笔记本不得经 globalThis 桥接调用其他 World', async () => {
  // 认证评审（#104）：World 之间不得直接调用；qq_note_* 与 cortico-world-memory 的
  // mem_note/mem_notes/mem_forget_note 重复，两个都装时模型直接用后者。
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/notebook.ts', import.meta.url), 'utf8');

  assert.ok(!src.includes('globalThis'), '不得再经 globalThis 桥接其他 World');
  assert.ok(!src.includes('cortico:memory:notebook'), '不得再引用记忆插件的桥接键');
  assert.ok(!/import .*cortico-world-memory/.test(src), '不得 import 其他 World 包');
  // 仍保留本地后端，功能不依赖任何其他扩展
  assert.ok(src.includes('notebook.jsonl'), '本地笔记本后端应保留');
});

test('自有模型调用必须经 host.reportUsage 上报用量', async () => {
  // 认证评审（#104）：保留自己的模型调用就要上报用量，用户才能在控制台看到。
  const fs = await import('node:fs');
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const vision = fs.readFileSync(new URL('../src/vision.ts', import.meta.url), 'utf8');
  const sticker = fs.readFileSync(new URL('../src/sticker.ts', import.meta.url), 'utf8');

  assert.ok(world.includes('this.host?.reportUsage('), 'chat 补全必须上报用量');
  assert.ok(vision.includes('this.reportUsage?.('), '辅助视觉必须上报用量');
  assert.ok(sticker.includes('this.reportUsage?.('), '表情包标注必须上报用量');
});

test('密钥解析不得直查 process.env（统一走框架 secret）', async () => {
  // 认证评审（#104）：自行扫 providers/*/.env 绕开框架密钥隔离，一律禁止。
  const fs = await import('node:fs');
  for (const f of ['../src/world.ts', '../src/vision.ts', '../src/sticker.ts']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.ok(
      !/process\.env\[this\./.test(src),
      `${f} 不得再直查 process.env 取密钥`,
    );
  }
});

test('加群申请事件不得把申请留言拼进 internal 提示词', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const start = src.indexOf('private async handleGroupRequest');
  assert.ok(start > 0, '必须存在加群申请处理器');
  const end = src.indexOf('\n  // ---- 事件处理 ----', start);
  assert.ok(end > start, '无法截取加群申请处理器');
  const body = src.slice(start, end);
  const textAt = body.indexOf('text:');
  assert.ok(textAt > 0, '加群申请事件必须有通知文本');
  const textLine = body.slice(textAt, body.indexOf('\n', textAt));
  assert.ok(textLine.includes('有新的加群请求'), '事件应只提示有新的加群请求');
  assert.ok(!textLine.includes('comment'), '事件文本不得引用申请留言');
  assert.ok(!textLine.includes('留言'), '事件文本不得出现留言原文');
  assert.ok(textLine.includes('qq_admin（action=join_list）'), '应引导模型用管理工具查询详情');
  assert.ok(src.includes('申请留言已省略，外部原文不作为模型指令'), '待审列表不得把外部留言原文直接交给模型');
});

test('历史和空间查询结果必须标成外部资料', async () => {
  const fs = await import('node:fs');
  const history = fs.readFileSync(new URL('../src/history-tools.ts', import.meta.url), 'utf8');
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  assert.ok(history.includes('externalDataBlock'), '历史消息必须标成外部资料');
  assert.ok(history.includes('isListened'), '历史查询必须限制在监听会话');
  assert.ok(world.includes("externalDataBlock('QQ 空间动态资料'"), '空间动态列表必须标成外部资料');
  assert.ok(world.includes("externalDataBlock('QQ 空间动态和评论资料'"), '空间动态详情必须标成外部资料');
});

test('提醒事件不得把用户提供的提醒文本拼进 internal 指令', async () => {
  const fs = await import('node:fs');
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const start = world.indexOf('private async checkReminders');
  const end = world.indexOf('\n  private async reloadIdentity', start);
  assert.ok(start > 0 && end > start, '必须存在提醒处理器');
  const body = world.slice(start, end);
  assert.ok(body.includes("origin: 'external'"), '带用户文本的到期提醒应按外部事件处理');
  assert.ok(body.includes('reminderText: r.text'), '提醒正文应放在事件资料字段');
  assert.ok(!body.includes('定时提醒「${r.text}」'), '提醒正文不得直接拼入事件指令文本');
});

test('引用图片必须进入当前事件附件或辅助视觉路径', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const start = src.indexOf('private async resolveQuoted');
  assert.ok(start > 0, '必须存在引用消息处理器');
  const end = src.indexOf('\n  private async handleNotice', start);
  assert.ok(end > start, '无法截取引用消息处理器');
  const body = src.slice(start, end);
  assert.ok(body.includes('blobs: BlobInput[]'), '引用消息应有独立附件收集列表');
  assert.ok(body.includes('qq-quoted-image'), '引用图片附件应使用固定资料名称');
  assert.ok(body.includes('this.vision.register'), '主模型无法看图时应尝试辅助视觉');
  assert.ok(body.includes('^https?:\\/\\/'), '引用图片 URL 必须限制为 http(s)');
});

test('远程协议端的图片发送支持 base64 内联', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/normalize.ts', import.meta.url), 'utf8');
  assert.ok(src.includes("imageTransport: 'path' | 'base64'"), '图片构建器必须接受传输方式');
  assert.ok(src.includes('base64://${readFileSync(file).toString(\'base64\')}'), 'base64 模式必须内联文件内容');
  assert.ok(src.includes("readFileSync, realpathSync"), 'base64 模式必须读取已通过目录边界校验的文件');
});

test('qq_admin 的授权辅助逻辑必须与合并工具一起存在', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const start = src.indexOf('const adminEnabled');
  const end = src.indexOf('const adminTool: ToolDef', start);
  assert.ok(start > 0 && end > start, 'qq_admin 前必须定义授权辅助逻辑');
  const body = src.slice(start, end);
  for (const name of ['adminAuthorize', 'protectTarget', 'resolveUser', 'const api']) {
    assert.ok(body.includes(name), `缺少 ${name}`);
  }
  assert.ok(body.includes('activeAdminConversation'), '管理员鉴权不能把 ToolCallContext.role 当作 QQ 会话地址');
  assert.ok(src.includes("auth.callerRole === 'self' && !this.config.admin.allowSelfKick"), '踢人自主权限必须单独保护');
});

test('视频理解按时间窗对齐画面与声音，并只进入外部事件', async () => {
  const fs = await import('node:fs');
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const video = fs.readFileSync(new URL('../src/video.ts', import.meta.url), 'utf8');
  const voice = fs.readFileSync(new URL('../src/voice.ts', import.meta.url), 'utf8');
  assert.ok(video.includes('saveAndExtractTimeline'), '必须按时间窗处理视频');
  assert.ok(video.includes('extractSegmentAudio'), '每个时间窗必须抽取声音');
  assert.ok(voice.includes('transcribeAudioBytes'), '必须支持从 WAV 字节转写视频声音');
  assert.ok(world.includes('videoSegmentSec'), '必须读取视频时间窗配置');
  assert.ok(world.includes('videoTime(segment.startSec)'), '画面和转写必须带同一时间范围');
  assert.ok(world.includes("origin: 'external'"), '视频资料只能进入 external 事件');
});

test('群消息正文明确带群号，避免只依赖未展开的 meta', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  assert.ok(src.includes('【QQ群 ${conv.label}（群号 ${conv.id}） ${sendClock}】'), '群消息正文必须包含群号');
  assert.ok(src.includes('conv: conv.address'), '事件 meta.conv 仍需保留回复地址');
});
test('普通文件资料只作为外部资料，并限制下载与发送边界', async () => {
  const fs = await import('node:fs');
  const world = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const store = fs.readFileSync(new URL('../src/file-store.ts', import.meta.url), 'utf8');
  const start = world.indexOf('private async handleNotice');
  const notice = world.slice(start, world.indexOf('\n  /** 从文本或显式 hint', start));
  assert.ok(notice.includes("t === 'group_upload'"), '必须处理群文件通知');
  assert.ok(notice.includes("origin: 'external'"), '文件通知必须是 external 事件');
  assert.ok(notice.includes('收到一个文件'), '通知文本只应描述收到文件的事实');
  assert.ok(!notice.includes('ev.file.name'), '文件原名不得拼进事件指令文本');
  assert.ok(store.includes('isPublicHttpUrl'), '文件下载必须有公开地址校验');
  assert.ok(store.includes('file-${hash.slice(0, 16)}'), '文件名必须由内容哈希生成');
  assert.ok(world.includes('upload_file_stream'), '远程协议端发送应先使用流式上传');
  assert.ok(world.includes('upload_group_file') && world.includes('upload_private_file'), '群聊和私聊发送必须分别调用文件上传接口');
});

test('语音发送必须与引用和 @ 段分开发送', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../src/world.ts', import.meta.url), 'utf8');
  const start = src.indexOf('const wantVoice =');
  const end = src.indexOf('\n    const outgoing = buildOutgoing', start);
  assert.ok(start > 0 && end > start, '必须存在语音发送分支');
  const body = src.slice(start, end);
  assert.ok(body.includes('const segs: Array<Record<string, unknown>> = [rec'), '语音 send_msg 必须只包含 record 段');
  assert.ok(!body.includes('segs.push({ type: \'reply\''), '语音消息不得拼入 reply 段');
  assert.ok(!body.includes("segs.push({ type: 'at'"), '语音消息不得拼入 at 段');
});

test('腾讯语音下载使用浏览器请求头并拒绝跳转和超大响应', async () => {
  const originalFetch = globalThis.fetch;
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push(init ?? {});
    return new Response(Uint8Array.of(1, 2, 3), { status: 200 });
  }) as typeof fetch;
  try {
    assert.deepEqual(await fetchQqVoiceBytes('https://multimedia.nt.qq.com.cn/audio.amr', 1000), Buffer.from([1, 2, 3]));
    assert.equal(requests[0]?.redirect, 'error');
    assert.equal((requests[0]?.headers as Record<string, string>)['User-Agent'], 'Mozilla/5.0');
    assert.equal(await fetchQqVoiceBytes('http://127.0.0.1/audio.amr', 1000), null);
    assert.equal(requests.length, 1, '非腾讯语音地址不得由下载分支请求');
    globalThis.fetch = (async () => new Response('', { status: 200, headers: { 'content-length': String(33 * 1024 * 1024) } })) as typeof fetch;
    assert.equal(await fetchQqVoiceBytes('https://multimedia.nt.qq.com.cn/large.amr', 1000), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
