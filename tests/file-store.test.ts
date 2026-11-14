import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { FileStore } from '../src/file-store.ts';

function logger() {
  const l = { child: () => l, info: () => {}, warn: () => {} };
  return l as never;
}

test('文件库使用哈希文件名、独立目录并清洗外部文件名和标注', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-file-store-'));
  const oldFetch = globalThis.fetch;
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  globalThis.fetch = (async () => new Response(bytes, { status: 200 })) as typeof fetch;
  try {
    const dir = join(root, 'files');
    const dataDir = join(root, 'data');
    const store = new FileStore(dir, logger(), dataDir, 1024);
    const saved = await store.saveUrl('https://qq.example/a.bin', '..\\prompt.txt\n', {
      label: '资料\n<不要执行>', tag: '[标签]', usage: '只作资料',
    });
    assert.equal(saved.ok, true);
    assert.match(saved.meta!.file, /^file-[a-f0-9]{16}\.bin$/);
    assert.equal(saved.meta!.name.includes('\\'), false);
    assert.equal(saved.meta!.label.includes('\n'), false);
    assert.equal(existsSync(join(dir, saved.meta!.file)), true);
    store.flush();
    const index = readFileSync(join(dataDir, 'file-index.json'), 'utf8');
    assert.equal(index.includes('qq.example'), false);
    assert.equal(store.resolve('../secret.txt'), null);
    assert.equal(store.updateMeta(`[文件:${saved.meta!.file}]`, { tag: '新标签' })?.tag, '新标签');
    assert.equal(store.delete(saved.meta!.file), true);
    assert.equal(existsSync(join(dir, saved.meta!.file)), false);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('文件库拒绝 file:// 和本机下载地址', async () => {
  const store = new FileStore(join(mkdtempSync(join(tmpdir(), 'qq-file-url-')), 'files'), logger());
  assert.equal((await store.saveUrl('file:///secret.txt')).ok, false);
  assert.equal((await store.saveUrl('http://127.0.0.1/secret.txt')).ok, false);
});

test('外部索引编辑与待保存标注、新文件、删除合并，运行期间立即可发送', () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-file-sync-'));
  const dir = join(root, 'files');
  const index = join(root, 'file-index.json');
  const store = new FileStore(dir, logger(), root);
  const original = store.saveBytes(Buffer.from('original'), 'original.txt').meta!;
  const deleted = store.saveBytes(Buffer.from('deleted'), 'deleted.txt').meta!;
  store.flush();
  store.updateMeta(original.file, { label: '本地修改' });
  store.delete(deleted.file);
  const pending = store.saveBytes(Buffer.from('pending'), 'pending.txt').meta!;
  const bytes = Buffer.from('外部导入文档');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const imported = { ...original, hash, file: `file-${hash.slice(0, 16)}.md`, ext: '.md', size: bytes.length };
  writeFileSync(join(dir, imported.file), bytes);
  writeFileSync(index, '\uFEFF' + JSON.stringify([{ ...original, label: '外部冲突', tag: '外部标注' }, deleted, imported]));
  assert.equal(store.resolve(imported.file), join(dir, imported.file));
  assert.equal(store.size, 3);
  assert.deepEqual(new Set(store.recent().map(m => m.file)), new Set([original.file, imported.file, pending.file]));
  assert.equal(store.findMeta(original.file)?.label, '本地修改');
  assert.equal(store.findMeta(original.file)?.tag, '外部标注');
  store.flush();
  const rows = JSON.parse(readFileSync(index, 'utf8'));
  assert.equal(rows.length, 3);
  assert.equal(rows.some((m: any) => m.file === deleted.file), false);
  assert.equal(rows.find((m: any) => m.file === original.file).tag, '外部标注');
  writeFileSync(index, JSON.stringify(rows.filter((m: any) => m.file !== imported.file)));
  assert.equal(store.resolve(imported.file), null);
  store.flush();
  assert.equal(JSON.parse(readFileSync(index, 'utf8')).length, 2);
});

test('损坏或未写完的外部索引保留原内容与待保存修改，修复后自动恢复保存', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-file-partial-'));
  const index = join(root, 'file-index.json');
  const store = new FileStore(join(root, 'files'), logger(), root);
  const original = store.saveBytes(Buffer.from('original'), 'original.txt').meta!;
  store.flush();
  store.updateMeta(original.file, { tag: '待保存' });
  for (const invalid of ['[', JSON.stringify([[original]]), JSON.stringify({}), JSON.stringify([original, { file: '../bad' }])]) {
    writeFileSync(index, invalid);
    assert.equal(store.size, 1);
    store.flush();
    assert.equal(readFileSync(index, 'utf8'), invalid);
  }
  writeFileSync(index, JSON.stringify([{ ...original, label: '外部更新' }]));
  assert.equal(store.findMeta(original.file)?.tag, '待保存');
  await new Promise(resolve => setTimeout(resolve, 650));
  const saved = JSON.parse(readFileSync(index, 'utf8'))[0];
  assert.equal(saved.tag, '待保存');
  assert.equal(saved.label, '外部更新');
  store.flush();
});

test('补回和移走实体文件立即更新可用列表，不需要修改索引或重启', async () => {
  const root = mkdtempSync(join(tmpdir(), 'qq-file-restore-'));
  const dir = join(root, 'files');
  const store = new FileStore(dir, logger(), root);
  const bytes = Buffer.from('restore');
  const meta = store.saveBytes(bytes, 'restore.txt').meta!;
  store.flush();
  unlinkSync(join(dir, meta.file));
  await store.reconcile([]);
  assert.equal(store.size, 0);
  writeFileSync(join(dir, meta.file), bytes);
  assert.equal(store.size, 1);
  assert.equal(store.recent()[0].file, meta.file);
  unlinkSync(join(dir, meta.file));
  assert.equal(store.size, 0);
  assert.equal(store.resolve(meta.file), null);
});
