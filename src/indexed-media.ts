import { createHash } from 'node:crypto';
import { lstatSync, writeFileSync } from 'node:fs';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';

type Entry = { hash: string; file: string };
type Kind = 'sticker' | 'image' | 'file';

// 旧 bot 包目录可能由多个部署共享：只认本部署索引里的哈希名，不遍历旧目录。
function validEntry(kind: Kind, entry: Entry): boolean {
  return /^[a-f0-9]{64}$/.test(entry.hash) &&
    /^[a-z]+-[a-f0-9]{16}\.[a-z0-9]{1,8}$/.test(entry.file) &&
    entry.file.startsWith(`${kind}-${entry.hash.slice(0, 16)}.`);
}

export class IndexedMediaFiles {
  private missing = new Set<string>();
  private readonly kind: Kind;
  private readonly dir: string;
  constructor(kind: Kind, dir: string) { this.kind = kind; this.dir = dir; }
  forget(hash: string): void { this.missing.delete(hash); }
  availableCount(total: number): number { return total - this.missing.size; }
  available(entry: Entry): boolean { return !this.missing.has(entry.hash); }

  async reconcile(entries: Iterable<Entry>, legacy: string[], log: Pick<Logger, 'warn' | 'info'>) {
    let restored = 0;
    const missing = new Set<string>();
    const examples: string[] = [];
    const roots = [...new Set(legacy.filter(Boolean).map(d => resolve(d)))].filter(d => d !== resolve(this.dir));
    for (const entry of entries) {
      let ok = false;
      if (validEntry(this.kind, entry)) {
        const dest = join(this.dir, entry.file);
        const current = await lstat(dest).catch(() => null);
        if (current) ok = current.isFile(); // 不跟随软链，不覆盖已有文件
        else for (const root of roots) {
          try {
            const src = join(root, entry.file);
            const st = await lstat(src);
            if (!st.isFile() || st.size > 64 * 1024 * 1024) continue;
            const bytes = await readFile(src);
            if (createHash('sha256').update(bytes).digest('hex') !== entry.hash) continue;
            await writeFile(dest, bytes, { flag: 'wx' });
            restored++;
            ok = true;
            break;
          } catch { /* 继续核对其他旧目录；最终统一记录缺失 */ }
        }
      }
      if (!ok) { missing.add(entry.hash); if (examples.length < 5) examples.push(entry.file); }
    }
    this.missing = missing;
    if (restored) log.info('已从旧媒体目录恢复索引文件', { kind: this.kind, restored, dir: this.dir });
    if (missing.size) log.warn('媒体索引有记录但文件不可用，已从可用列表隐藏（保留标注）', { kind: this.kind, count: missing.size, examples, dir: this.dir, legacy: roots });
  }

  // 同一内容再次到达时保留原文件名和标注，并修复缺失的实体文件。
  repair(entry: Entry, bytes: Uint8Array): boolean {
    if (!validEntry(this.kind, entry)) return false;
    const dest = join(this.dir, entry.file);
    try {
      writeFileSync(dest, bytes, {flag: 'wx'});
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || !lstatSync(dest, {throwIfNoEntry:false})?.isFile()) return false;
    }
    this.missing.delete(entry.hash);
    return true;
  }
}
