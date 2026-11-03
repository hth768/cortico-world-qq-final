import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { VideoStore } from '../src/video.ts';

function logger() {
  const l = { child: () => l, info: () => {}, warn: () => {} };
  return l as never;
}

test('视频只接受 http(s)，按哈希文件名保存到独立目录', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-video-store-'));
  const oldFetch = globalThis.fetch;
  const bytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as typeof fetch;
  try {
    const store = new VideoStore(join(root, 'videos'), ['definitely-missing-ffmpeg'], logger(), 1024, 2000);
    assert.equal(await store.saveAndExtract('file:///secret.mp4', 1, 12), null);
    const saved = await store.saveAndExtract('https://qq.example/video.mp4?untrusted=1', 1, 12);
    assert.ok(saved);
    assert.match(saved.file, /^video-[a-f0-9]{16}\.mp4$/);
    assert.equal(existsSync(join(root, 'videos', saved.file)), true);
    assert.deepEqual(readFileSync(join(root, 'videos', saved.file)), Buffer.from(bytes));
    assert.equal(saved.frameBytes, null);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('视频时间轴在 ffmpeg 不可用时保留文件并静默返回空片段', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-video-timeline-'));
  const oldFetch = globalThis.fetch;
  const bytes = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as typeof fetch;
  try {
    const store = new VideoStore(join(root, 'videos'), ['definitely-missing-ffmpeg'], logger(), 1024, 2000);
    const timeline = await store.saveAndExtractTimeline('https://qq.example/video.mp4', {
      intervalSec: 1,
      segmentSec: 8,
      maxFrames: 8,
      maxSegments: 3,
      audio: true,
    });
    assert.ok(timeline);
    assert.equal(timeline.durationSec, null);
    assert.deepEqual(timeline.segments, []);
    assert.equal(existsSync(join(root, 'videos', timeline.file)), true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('真实 FFmpeg：8 秒时间窗不混入下个片段，第二窗仍有画面', { skip: !process.env.QQ_TEST_FFMPEG }, async (t) => {
  const { spawnSync } = await import('node:child_process');
  const { rmSync } = await import('node:fs');
  const root = mkdtempSync(join(tmpdir(), 'qq-video-real-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const ffmpeg = process.env.QQ_TEST_FFMPEG!;
  const input = join(root, 'two-colors.mkv');
  const run = (args: string[], inputBytes?: Uint8Array) => {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { input: inputBytes, maxBuffer: 10 * 1024 * 1024, windowsHide: true });
    assert.equal(result.status, 0, result.stderr?.toString());
    return result.stdout;
  };
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x64:r=10:d=8', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:r=10:d=8', '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'ffv1', input]);
  const store: any = new VideoStore(root, [ffmpeg], logger());
  const first = await store.extractSegmentFrames(input, 0, 8, 1, 12);
  const second = await store.extractSegmentFrames(input, 8, 8, 1, 12);
  assert.ok(first?.length, '第一窗应有画面');
  assert.ok(second?.length, '第二窗应有画面');
  const pixel = (png: Uint8Array, x: number, y: number) => {
    const raw = run(['-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], png);
    const width = Buffer.from(png).readUInt32BE(16);
    return [...raw.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)];
  };
  assert.ok(pixel(first, 100, 100)[0] > 200, '第一窗是红色');
  assert.ok(pixel(second, 100, 100)[2] > 200, '第二窗是蓝色');
  assert.ok(pixel(first, 100, 700).every((v) => v < 10), '第一窗不能混入8秒后的蓝色画面');
});
