import { IndexedMediaFiles } from './indexed-media.ts';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import type { Logger } from 'cortico/core/types.ts';
import { isIP } from 'node:net';

const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
const MAX_FIELD = 80;
const FILE_RE = /^file-[a-f0-9]{16}\.[a-z0-9]{1,8}$/i;
const ALLOWED_EXT = new Set(['.7z', '.avi', '.bin', '.csv', '.doc', '.docx', '.flac', '.gif', '.gz', '.jpg', '.jpeg', '.json', '.m4a', '.mkv', '.mov', '.mp3', '.mp4', '.pdf', '.png', '.ppt', '.pptx', '.rar', '.tar', '.txt', '.wav', '.webm', '.webp', '.xls', '.xlsx', '.xml', '.zip']);

function isPublicHttpUrl(raw: string): boolean {
  if (!/^https?:\/\//i.test(raw)) return false;
  try {
    const h = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    if (!h || h === 'localhost' || h === '0.0.0.0' || h === 'metadata.google.internal') return false;
    const ip = isIP(h);
    if (ip === 4) {
      const p = h.split('.').map(Number);
      if (p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)) return false;
    } else if (ip === 6 && (h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:'))) return false;
    return true;
  } catch { return false; }
}

export interface FileMeta {
  hash: string;
  ext: string;
  file: string;
  name: string;
  label: string;
  tag: string;
  usage: string;
  size: number;
  firstSaved: number;
  lastSaved: number;
  count: number;
}

export interface FilePatch { label?: string; tag?: string; usage?: string; }
export interface FileStoreResult { ok: boolean; meta?: FileMeta; error?: string; }

/**
 * 收到的普通文件资料库。
 *
 * 文件名由内容 sha256 生成，索引不保存来源 URL 或消息原文；工具只能引用
 * list 返回的固定文件名。外部文件名只作清洗后的资料字段，不会被拼入内部事件。
 */
export class FileStore {
  private readonly indexedFiles: IndexedMediaFiles;
  reconcile(legacy: string[]): Promise<void> {
    return this.indexedFiles.reconcile(this.meta.values(), legacy, this.log);
  }
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly log: Logger;
  private readonly indexFile: string;
  private readonly meta = new Map<string, FileMeta>();
  private diskMeta = new Map<string, FileMeta>();
  private diskText: string | undefined;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(dir: string, log: Logger, dataDir = '', maxBytes = DEFAULT_MAX_BYTES) {
    this.dir = dir;
    this.indexedFiles = new IndexedMediaFiles('file', dir);
    this.log = log.child('file-store');
    this.indexFile = dataDir ? join(dataDir, 'file-index.json') : '';
    this.maxBytes = Number.isFinite(maxBytes) && maxBytes > 0 ? Math.min(maxBytes, DEFAULT_MAX_BYTES) : DEFAULT_MAX_BYTES;
    try {
      if (dataDir && !existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
      if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
    } catch {
      this.log.warn('无法创建文件资料库目录', { dir: this.dir });
    }
    this.refresh();
  }

  get size(): number {
    this.refresh();
    return [...this.meta.values()].filter(m => this.available(m)).length;
  }
  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    this.save();
  }
  recent(limit = 10): FileMeta[] {
    this.refresh();
    return [...this.meta.values()].filter(m => this.available(m)).sort((a, b) => b.lastSaved - a.lastSaved).slice(0, Math.max(1, Math.min(50, Math.floor(limit)))).map((m) => ({ ...m }));
  }

  async saveUrl(url: string, name = '', patch: FilePatch = {}): Promise<FileStoreResult> {
    const bytes = await this.fetchBytes(url);
    return bytes ? this.saveBytes(bytes, name, patch) : { ok: false, error: `文件下载失败或超过 ${Math.floor(this.maxBytes / 1024 / 1024)} MiB 大小上限。` };
  }

  saveBytes(bytes: Uint8Array, name = '', patch: FilePatch = {}): FileStoreResult {
    if (bytes.byteLength > this.maxBytes) return { ok: false, error: `文件超过 ${Math.floor(this.maxBytes / 1024 / 1024)} MiB 大小上限。` };
    this.refresh();
    const hash = createHash('sha256').update(bytes).digest('hex');
    const ext = this.extOf(name, bytes);
    const file = `file-${hash.slice(0, 16)}${ext}`;
    const old = this.meta.get(hash);
    if (old) {
      if (!this.indexedFiles.repair(old, bytes)) return { ok: false, error: '文件不可恢复。' };
      old.count += 1;
      old.lastSaved = Date.now();
      this.applyPatch(old, patch);
      this.scheduleSave();
      return { ok: true, meta: { ...old } };
    }
    const path = join(this.dir, file);
    try {
      writeFileSync(path, bytes, { flag: 'wx' });
    } catch {
      if (!existsSync(path)) return { ok: false, error: '文件写入失败。' };
    }
    const now = Date.now();
    const meta: FileMeta = {
      hash, ext, file, size: bytes.byteLength,
      name: this.cleanFileName(name) || file,
      label: '文件', tag: '', usage: '', firstSaved: now, lastSaved: now, count: 1,
    };
    this.applyPatch(meta, patch);
    this.meta.set(hash, meta);
    this.scheduleSave();
    this.log.info('文件已保存', { file, size: bytes.byteLength });
    return { ok: true, meta: { ...meta } };
  }

  updateMeta(file: string, patch: FilePatch): FileMeta | null {
    const m = this.find(file);
    if (!m) return null;
    this.applyPatch(m, patch);
    this.scheduleSave();
    return { ...m };
  }

  delete(file: string): boolean {
    const m = this.find(file);
    if (!m) return false;
    this.indexedFiles.forget(m.hash);
    this.meta.delete(m.hash);
    try { unlinkSync(this.safePath(m.file)); } catch { /* 索引仍删除 */ }
    this.scheduleSave();
    return true;
  }

  /** 仅返回索引中已存在且仍在 fileDir 内的普通文件。 */
  resolve(file: string): string | null {
    const m = this.find(file);
    if (!m) return null;
    try {
      const path = this.safePath(m.file);
      if (!statSync(path).isFile()) return null;
      return path;
    } catch { return null; }
  }

  findMeta(file: string): FileMeta | null {
    const m = this.find(file);
    return m ? { ...m } : null;
  }

  private find(file: string): FileMeta | null {
    this.refresh();
    const raw = typeof file === 'string' ? file.trim() : '';
    const key = this.cleanField(raw.replace(/^\[文件:/i, '').replace(/\]$/, ''), 120).toLowerCase();
    if (!FILE_RE.test(key)) return null;
    return [...this.meta.values()].find((m) => m.file.toLowerCase() === key) ?? null;
  }

  private available(meta: FileMeta): boolean {
    if (!/^[a-f0-9]{64}$/.test(meta.hash) || !meta.file.startsWith(`file-${meta.hash.slice(0, 16)}.`)) return false;
    try { return lstatSync(this.safePath(meta.file)).isFile(); }
    catch { return false; }
  }

  private safePath(file: string): string {
    if (!FILE_RE.test(file)) throw new Error('invalid file name');
    const base = resolve(this.dir);
    const path = resolve(base, file);
    const rel = relative(base, path);
    if (!rel || rel.startsWith('..') || /^[a-zA-Z]:/.test(rel)) throw new Error('file path escaped');
    if (existsSync(path)) {
      const realBase = realpathSync(base);
      const realRel = relative(realBase, realpathSync(path));
      if (!realRel || realRel.startsWith('..') || /^[a-zA-Z]:/.test(realRel)) throw new Error('file symlink escaped');
    }
    return path;
  }

  private applyPatch(meta: FileMeta, patch: FilePatch): void {
    const label = this.cleanField(patch.label);
    const tag = this.cleanField(patch.tag);
    const usage = this.cleanField(patch.usage);
    if (label) meta.label = label;
    if (tag) meta.tag = tag;
    if (usage) meta.usage = usage;
  }

  private cleanFileName(value: unknown): string {
    return this.cleanField(value, 120).replace(/[\\/]/g, '_').replace(/^\.+$/, '').trim();
  }

  private cleanField(value: unknown, max = MAX_FIELD): string {
    if (typeof value !== 'string') return '';
    return value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/[\r\n\t]/g, ' ').replace(/[\[\]{}<>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  }

  private extOf(name: string, bytes: Uint8Array): string {
    const ext = extname(String(name).split(/[?#]/)[0]).toLowerCase();
    if (ALLOWED_EXT.has(ext)) return ext;
    const head = Buffer.from(bytes.subarray(0, 12));
    if (head[0] === 0x25 && head.toString('ascii', 0, 5) === '%PDF-') return '.pdf';
    if (head[0] === 0x50 && head[1] === 0x4b) return '.zip';
    if (head[0] === 0xff && head[1] === 0xd8) return '.jpg';
    if (head[0] === 0x89 && head.toString('ascii', 1, 4) === 'PNG') return '.png';
    return '.bin';
  }

  private async fetchBytes(url: string): Promise<Uint8Array | null> {
    if (!isPublicHttpUrl(url)) return null;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      const length = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(length) && length > this.maxBytes) return null;
      if (!res.body) {
        const body = new Uint8Array(await res.arrayBuffer());
        return body.byteLength <= this.maxBytes ? body : null;
      }
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          total += part.value.byteLength;
          if (total > this.maxBytes) { await reader.cancel(); return null; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
      return out;
    } catch { return null; } finally { clearTimeout(timer); }
  }

  /** 用上次磁盘快照作基线，合并外部编辑与尚未落盘的本地修改。 */
  private refresh(): boolean {
    if (!this.indexFile) return true;
    try {
      const text = readFileSync(this.indexFile, 'utf8');
      if (text === this.diskText) {
        if (!this.saveTimer && JSON.stringify([...this.meta]) !== JSON.stringify([...this.diskMeta])) this.scheduleSave();
        return true;
      }
      const raw = JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
      if (!Array.isArray(raw)) throw new Error('文件索引必须是 JSON 数组');
      const disk = new Map<string, FileMeta>();
      for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('文件索引条目格式错误');
        const m = item as FileMeta;
        if (typeof m.hash !== 'string' || !FILE_RE.test(String(m.file)) || typeof m.size !== 'number') throw new Error('文件索引条目格式错误');
        disk.set(m.hash, { ...m, file: String(m.file), name: this.cleanFileName(m.name) || String(m.file), label: this.cleanField(m.label) || '文件', tag: this.cleanField(m.tag), usage: this.cleanField(m.usage), count: Math.max(1, Number(m.count) || 1) });
      }
      const merged = new Map([...disk].map(([hash, m]) => [hash, { ...m }]));
      for (const [hash, local] of this.meta) {
        const base = this.diskMeta.get(hash);
        if (!base) {
          merged.set(hash, { ...local });
          continue;
        }
        for (const field of Object.keys(local) as (keyof FileMeta)[]) {
          if (local[field] === base[field]) continue;
          const entry = merged.get(hash) ?? { ...local };
          Object.assign(entry, { [field]: local[field] });
          merged.set(hash, entry);
        }
      }
      // 本地删除优先，避免磁盘上的旧条目让已删除文件重新出现。
      for (const hash of this.diskMeta.keys()) {
        if (!this.meta.has(hash)) merged.delete(hash);
      }
      this.meta.clear();
      for (const [hash, m] of merged) this.meta.set(hash, m);
      this.diskMeta = disk;
      this.diskText = text;
      if (JSON.stringify([...merged]) !== JSON.stringify([...disk])) this.scheduleSave();
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' && this.diskText === undefined) return true;
      this.log.warn('文件索引暂不可读，保留内存资料并暂停写回', { err: String(e) });
      return false;
    }
  }

  private scheduleSave(): void {
    if (!this.indexFile || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = undefined; this.save(); }, 500);
  }

  private save(): void {
    if (!this.indexFile || !this.refresh()) return;
    const tmp = `${this.indexFile}.${randomUUID()}.tmp`;
    try {
      const text = JSON.stringify([...this.meta.values()], null, 2);
      writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
      // 临时文件写入期间若索引又被修改，下一次保存重新合并。
      const current = existsSync(this.indexFile) ? readFileSync(this.indexFile, 'utf8') : undefined;
      if (current !== this.diskText) {
        this.scheduleSave();
        return;
      }
      renameSync(tmp, this.indexFile);
      this.diskText = text;
      this.diskMeta = new Map([...this.meta].map(([hash, m]) => [hash, { ...m }]));
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    } catch (e) {
      this.log.warn('文件资料库索引保存失败，保留待保存修改', { err: String(e) });
    } finally {
      try { unlinkSync(tmp); } catch { /* 成功重命名后临时文件已不存在 */ }
    }
  }
}

export const __fileNamePatternForTest = FILE_RE;
