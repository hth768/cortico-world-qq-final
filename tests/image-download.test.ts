import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate as nextTick } from 'node:timers/promises';
import { downloadImage } from '../src/image-download.ts';

function mockFetch(t: TestContext, implementation: typeof fetch): void {
  const original = globalThis.fetch;
  globalThis.fetch = implementation;
  t.after(() => { globalThis.fetch = original; });
}

function streamed(chunks: number[][], headers: Record<string, string> = {}) {
  let pulls = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[pulls++];
      if (chunk) controller.enqueue(Uint8Array.from(chunk));
      else controller.close();
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  return { response: new Response(body, { headers }), pulls: () => pulls, cancelled: () => cancelled };
}

test('完整读取多段图片，在恰好到达大小上限时成功', async t => {
  const image = streamed([[1, 2], [3, 4]], { 'content-length': '4' });
  mockFetch(t, async () => image.response);
  const result = await downloadImage('https://example.invalid/image', { maxBytes: 4 });
  assert.deepEqual(Array.from(result!), [1, 2, 3, 4]);
});

test('缺少 Content-Length 时仍按实际字节数检查上限', async t => {
  const image = streamed([[1, 2, 3], [4, 5, 6], [7, 8]]);
  mockFetch(t, async () => image.response);
  assert.equal(await downloadImage('https://example.invalid/image', { maxBytes: 4 }), null);
  assert.equal(image.pulls(), 2);
  assert.equal(image.cancelled(), true);
});

test('错误偏小的 Content-Length 不能绕过实际字节上限', async t => {
  const image = streamed([[1, 2, 3, 4, 5]], { 'content-length': '1' });
  mockFetch(t, async () => image.response);
  assert.equal(await downloadImage('https://example.invalid/image', { maxBytes: 4 }), null);
  assert.equal(image.cancelled(), true);
});

test('已声明超过上限的图片在读取响应体前拒绝', async t => {
  const image = streamed([[1]], { 'content-length': '999999999999999999999999999999999999' });
  mockFetch(t, async () => image.response);
  assert.equal(await downloadImage('https://example.invalid/image', { maxBytes: 4 }), null);
  assert.equal(image.pulls(), 0);
  assert.equal(image.cancelled(), true);
});

test('单个过大的响应块立即停止，不继续读取后续块', async t => {
  const image = streamed([[1, 2, 3, 4, 5], [6]]);
  mockFetch(t, async () => image.response);
  assert.equal(await downloadImage('https://example.invalid/image', { maxBytes: 4 }), null);
  assert.equal(image.pulls(), 1);
  assert.equal(image.cancelled(), true);
});

test('响应头到达后正文停滞，原超时仍生效并取消下载', { timeout: 2000 }, async t => {
  let signal: AbortSignal;
  let cancelled = false;
  mockFetch(t, async (_, options) => {
    signal = options!.signal!;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  });
  const pending = downloadImage('https://example.invalid/stall', { timeoutMs: 30 });
  await nextTick();
  assert.equal(signal!.aborted, false);
  assert.equal(await pending, null);
  assert.equal(signal!.aborted, true);
  assert.equal(cancelled, true);
});

test('请求尚未返回响应头时也按时退出', { timeout: 2000 }, async t => {
  let signal: AbortSignal;
  mockFetch(t, (_, options) => {
    signal = options!.signal!;
    return new Promise(() => {});
  });
  assert.equal(await downloadImage('https://example.invalid/no-headers', { timeoutMs: 20 }), null);
  assert.equal(signal!.aborted, true);
});

test('流的取消操作不返回也不能卡住超时退出', { timeout: 2000 }, async t => {
  mockFetch(t, async () => new Response(new ReadableStream({ cancel: () => new Promise(() => {}) })));
  assert.equal(await downloadImage('https://example.invalid/stuck-cancel', { timeoutMs: 20 }), null);
});

test('流读取异常返回失败，不产生未处理拒绝', async t => {
  mockFetch(t, async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken stream')); } })));
  assert.equal(await downloadImage('https://example.invalid/broken'), null);
  await nextTick();
});

test('HTTP 错误会取消响应体', async t => {
  let cancelled = false;
  mockFetch(t, async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), { status: 404 }));
  assert.equal(await downloadImage('https://example.invalid/missing'), null);
  assert.equal(cancelled, true);
});

test('无响应体和网络失败都返回空结果，后续图片仍可成功', async t => {
  let request = 0;
  mockFetch(t, async () => {
    request++;
    if (request === 1) return new Response(null, { status: 204 });
    if (request === 2) throw new Error('offline');
    return new Response(Uint8Array.from([1, 2]));
  });
  assert.equal(await downloadImage('https://example.invalid/empty'), null);
  assert.equal(await downloadImage('https://example.invalid/offline'), null);
  assert.deepEqual(Array.from((await downloadImage('https://example.invalid/ok'))!), [1, 2]);
});

test('非正整数或超出计时器范围的限制不能使下载变成无上限', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return new Response('x'); });
  for (const options of [{ maxBytes: 0 }, { maxBytes: NaN }, { maxBytes: 1.5 }, { timeoutMs: 0 }, { timeoutMs: 2 ** 31 }]) {
    assert.equal(await downloadImage('https://example.invalid/image', options), null);
  }
  assert.equal(calls, 0);
});

test('保留二进制 Buffer 行为，表情包魔数判断仍可用', async t => {
  mockFetch(t, async () => new Response(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])));
  const image = await downloadImage('https://example.invalid/image');
  assert.equal(Buffer.isBuffer(image), true);
  assert.equal(Buffer.from(image!).subarray(0, 4).toString('hex'), '52494646');
});
