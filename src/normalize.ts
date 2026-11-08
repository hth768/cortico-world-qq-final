import { nowIso, shortTime } from 'cortico/core/util.ts';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { faceName, faceIdByName } from './qface-map.ts';
import type { OneBotSegment } from './types.ts';

/**
 * 把「表情包:文件名」解析成表情包目录内的绝对路径，越界一律拒绝。
 *
 * 这个标记的文本来自**入站消息**，也就是群友可控内容。若直接 `join(emojiDir, fname)`，
 * `..\..\` 能一路逃出表情包目录，指向本机任意文件，再作为图片发出去——等于把
 * 「读取任意文件并外传」的能力交给任何能发言的人。这里做三重收敛：
 *   1. 拒绝绝对路径与含 `..` 的名字；
 *   2. 解析后必须仍落在 emojiDir 之内（含符号链接指向的真实路径再验一次）；
 *   3. 必须是普通文件。
 * 精确文件名不存在时，会在同一目录内补全或替换常见图片扩展名；任何候选都不满足时，
 * 当作「未配置/文件缺失」静默丢弃该标记（与原有降级行为一致）。
 */
function resolveEmojiFile(emojiDir: string, fname: string): string | null {
  try {
    if (!fname || fname.length > 200) return null;
    if (isAbsolute(fname) || /^[a-zA-Z]:/.test(fname) || fname.includes('\0')) return null;
    // 归一化各平台分隔符后，任何 `..` 片段都直接拒绝
    const unified = fname.replace(/\//g, sep);
    if (unified.split(sep).some((seg) => seg === '..')) return null;

    const base = resolve(emojiDir);
    const candidates = [resolve(base, unified)];
    const imageExtensions = ['.gif', '.png', '.jpg', '.jpeg', '.webp'];
    const extension = /\.[a-z0-9]{2,5}$/i;
    if (extension.test(unified)) {
      // 模型有时会根据经验猜扩展名；保留原名优先，再尝试常见图片扩展名。
      for (const ext of imageExtensions) {
        const swapped = resolve(base, unified.replace(extension, ext));
        if (!candidates.includes(swapped)) candidates.push(swapped);
      }
    } else {
      // 索引里可能只保存了不带扩展名的 hash 文件名。
      for (const ext of imageExtensions) candidates.push(resolve(base, unified + ext));
    }

    // 符号链接再验一次真实路径，防止「目录内软链指向目录外」
    const realBase = realpathSync(base);
    for (const target of candidates) {
      const rel = relative(base, target);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;

      let realTarget = '';
      try {
        realTarget = realpathSync(target);
      } catch {
        continue; // 当前候选不存在，继续尝试其它扩展名
      }
      const realRel = relative(realBase, realTarget);
      if (!realRel || realRel.startsWith('..') || isAbsolute(realRel)) continue;

      if (statSync(realTarget).isFile()) return target;
    }
    return null; // 所有候选都不存在或越界
  } catch {
    return null;
  }
}

// 仅供测试断言路径收敛用（命名空间导出不进入运行时契约）。
export const __resolveEmojiFileForTest = resolveEmojiFile;

/** 图片库使用同一套目录边界检查，但目录与 emojiDir 永远分开。 */
function resolveImageFile(imageDir: string, fname: string): string | null {
  return resolveEmojiFile(imageDir, fname);
}

export const __resolveImageFileForTest = resolveImageFile;

/** 把 OneBot 消息段数组渲染为对模型友好的纯文本（含引用/表情/@ 标注）。 */
export function renderIncoming(
  segments: OneBotSegment[] | string | undefined,
  ctx: { timezone: string; selfId: number; replyText?: string; replyRef?: string; fileNames?: (string | null)[] },
): string {
  if (typeof segments === 'string') return segments;
  if (!segments || !Array.isArray(segments)) return '';
  const out: string[] = [];
  let fileIndex = 0;
  if (ctx.replyText && ctx.replyRef) {
    out.push(`「引用 ${ctx.replyRef}${ctx.replyText ? '：' + ctx.replyText : ''}」`);
  }
  for (const seg of segments) {
    switch (seg.type) {
      case 'text':
        out.push(seg.data.text ?? '');
        break;
      case 'at':
        out.push(formatMention(seg.data.qq, seg.data.name, ctx.selfId));
        break;
      case 'face':
        out.push(`[表情${seg.data.id}：${faceName(Number(seg.data.id))}]`);
        break;
      case 'image':
        out.push(seg.data.summary ? `[图片：${seg.data.summary}]` : '[图片]');
        break;
      case 'markdown':
        // QQ 机器人（官方 bot / 第三方 bot）发的图文卡片是 markdown 段，
        // 原样落到 default 只会剩一个 [markdown] 占位，正文全丢。
        out.push(renderMarkdownSegments(String((seg.data as { content?: string }).content ?? '')) || '[卡片]');
        break;
      case 'record':
        out.push('[语音]');
        break;
      case 'video':
        out.push('[视频]');
        break;
      case 'file':
        // 文件名来自外部消息，不能原样拼进提示词；world 会在成功落盘后补充
        // 由内容哈希生成的固定文件名，未能下载时只保留中性占位。
        if (ctx.fileNames) {
          const file = ctx.fileNames[fileIndex++];
          out.push(file ? `[文件:${file}]` : '[文件未保存：未取得下载地址或下载/保存失败]');
        } else out.push('[文件]');
        break;
      case 'forward':
        out.push('[合并转发消息]');
        break;
      case 'json':
      case 'xml': {
        const card = parseJsonCard(seg.data.data);
        out.push(card ? `[卡片：${card}]` : '[卡片]');
        break;
      }
      default:
        out.push(`[${seg.type}]`);
    }
  }
  return out.join('').trim();
}

/** 机器人 markdown 段 → 可读文字：图片语法→[图片]，链接只留文字，去掉标题/加粗标记。 */
export function renderMarkdownSegments(content: string): string {
  return String(content ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function formatMention(qq: string, name: string | undefined, selfId: number): string {
  const id = Number(qq);
  if (id === selfId) return '@我';
  return name ? `@${name}` : `@${qq}`;
}

/** 纯文本形态（无引用），用于历史/搜索展示。 */
export function renderSegmentsPlain(segments: OneBotSegment[] | string | undefined): string {
  if (typeof segments === 'string') return segments;
  if (!segments || !Array.isArray(segments)) return '';
  return segments
    .map((seg) => {
      switch (seg.type) {
        case 'text':
          return seg.data.text ?? '';
        case 'at':
          return `@${seg.data.name ?? seg.data.qq}`;
        case 'face':
          return `[表情${seg.data.id}]`;
        case 'image':
          return '[图片]';
        case 'markdown':
          return renderMarkdownSegments(String((seg.data as { content?: string }).content ?? '')) || '[卡片]';
        case 'record':
          return '[语音]';
        case 'video':
          return '[视频]';
        case 'file':
          return '[文件]';
        case 'forward':
          return '[合并转发]';
        default:
          return `[${seg.type}]`;
      }
    })
    .join('');
}

/**
 * 把待发送文本构建为 OneBot 发送段（对齐 fat-fish parse_reply_segments）：
 *   - [表情包:文件名] → image 段（本地文件，位于 emojiDir 下；缺扩展名或写错常见扩展名时自动修正，仍找不到则丢弃）
 *   - [图片:文件名] → image 段（本地文件，位于 imageDir 下；目录与 emojiDir 分开）
 *   - [表情N] / [表情N:名称] → face 段
 *   - [中文表情名]（命中映射，如 [旺柴]/[笑哭]）→ face 段
 *   - @名字 / @QQ号 → at 段
 *   - 其它 [..] → 普通文本（保留方括号原样）
 * emojiDir/imageDir 为空时不解析对应标记。
 */
export function buildOutgoing(text: string, emojiDir = '', imageDir = '', imageTransport: 'path' | 'base64' = 'path', stickerDir = emojiDir, onMissing?: (kind: string) => void): OneBotSegment[] {
  const imageSegment = (file: string): OneBotSegment | null => {
    if (imageTransport === 'base64') {
      try {
        return { type: 'image', data: { file: `base64://${readFileSync(file).toString('base64')}` } };
      } catch {
        return null;
      }
    }
    return { type: 'image', data: { file } };
  };
  const segments: OneBotSegment[] = [];
  const re = /\[((?:表情包:|图片:)[^\[\]]{0,200}|[^\[\]]{1,40})\]|@([^\s@]{1,30})/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', data: { text: text.slice(last, m.index) } });
    if (m[1] !== undefined) {
      const inner = m[1];
      const whole = m[0];
      if (inner.startsWith('表情包:') || inner.startsWith('图片:')) {
        const sticker = inner.startsWith('表情包:');
        const fname = inner.slice(inner.indexOf(':') + 1).trim();
        const dirs = sticker ? [stickerDir, emojiDir] : [imageDir];
        let segment: OneBotSegment | null = null;
        for (const dir of new Set(dirs.filter(Boolean))) {
          const file = resolveEmojiFile(dir, fname);
          if (file) { segment = imageSegment(file); break; }
        }
        if (segment) segments.push(segment);
        else onMissing?.(sticker ? '表情包' : '图片');
      } else if (/^表情\s*\d+(?:[:：][^\]]*)?$/.test(inner)) {
        const id = inner.match(/^表情\s*(\d+)/)![1];
        segments.push({ type: 'face', data: { id: Number(id) } });
      } else {
        const fid = faceIdByName(inner);
        if (fid !== null) segments.push({ type: 'face', data: { id: fid } });
        else segments.push({ type: 'text', data: { text: whole } });
      }
    } else if (m[2] !== undefined) {
      // @名字 / @QQ号 → at 段。但 @all / @全体成员 / @everyone 一律视为普通文本：
      // at 全体是受 qq_admin（action=at_all）+ admin.enabled 授权保护的高危操作，
      // 不能在普通回复正文里被「写个 @all 就绕过去」。
      const mention = m[2];
      const isAtAll = /^all$|^全体成员$|^everyone$/i.test(mention);
      if (isAtAll) {
        segments.push({ type: 'text', data: { text: '@' + mention } });
      } else {
        segments.push({ type: 'at', data: { qq: mention, name: /^(\d{5,})$/.test(mention) ? undefined : mention } });
      }
    }
    last = re.lastIndex;
  }
  if (last < text.length) segments.push({ type: 'text', data: { text: text.slice(last) } });
  if (segments.length === 0 && !last) segments.push({ type: 'text', data: { text } });
  return segments;
}

export interface SplitReplyOptions {
  /** 是否按句拆分（false 则整段作为一条）。 */
  splitBySentence: boolean;
  /** 每条消息最多容纳句数。 */
  sentencesPerMessage: number;
  /** 单条消息字节上限，超过则对文字再按字节硬切。 */
  maxBytes: number;
}

/**
 * 把构建好的发送段拆成多条消息（对齐 fat-fish split_text_segments_by_sentence
 * + split_text_and_images）：文字按句标点或换行拆分，face 跟随最后一条，image 独立成条；
 * 单条仍超 maxBytes 时再按字节硬切。splitBySentence=false 则整体一条。
 */
export function splitReplyIntoMessages(segments: OneBotSegment[], opts: SplitReplyOptions): OneBotSegment[][] {
  const images = segments.filter((s) => s.type === 'image');
  const textParts = segments.filter((s) => s.type !== 'image');
  const groups: OneBotSegment[][] = [];

  if (textParts.length) {
    if (!opts.splitBySentence) {
      groups.push(textParts);
    } else {
      const fullText = textParts
        .filter((s) => s.type === 'text')
        .map((s) => (s.data as { text?: string }).text ?? '')
        .join('');
      const faces = textParts.filter((s) => s.type === 'face');
      // at 段必须跟着首条走：拆句时只重拼 text/face，@ 会被丢掉（表现为「发出去了但没亮红字」）
      const ats = textParts.filter((s) => s.type === 'at');
      const sentences = fullText
        .split(/(?<=[。！？!?；;])|\r\n|[\r\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sentences.length <= 1) {
        groups.push(textParts);
      } else {
        for (let i = 0; i < sentences.length; i += opts.sentencesPerMessage) {
          const chunk = sentences.slice(i, i + opts.sentencesPerMessage).join('');
          if (opts.maxBytes > 0 && Buffer.byteLength(chunk, 'utf8') > opts.maxBytes) {
            for (const sub of splitLongText(chunk, opts.maxBytes)) {
              groups.push([{ type: 'text', data: { text: sub } }]);
            }
          } else {
            groups.push([{ type: 'text', data: { text: chunk } }]);
          }
        }
        if (faces.length && groups.length) groups[groups.length - 1].push(...faces);
        if (ats.length && groups.length) groups[0].unshift(...ats);
      }
    }
  }
  for (const img of images) groups.push([img]);
  return groups.length ? groups : [[{ type: 'text', data: { text: '' } }]];
}

/** 把 [表情N] 标记展开成可读名称（用于 env/正文展示）。 */
export function renderTextWithFaces(text: string): string {
  return text.replace(/\[表情(\d+)(?::[^\]]*)?\]/g, (_m, id) => `[表情${id}：${faceName(Number(id))}]`);
}

/** 把长文本按字节数切分为多条（fat-fish split_for_sending 思路）。 */
export function splitLongText(text: string, maxBytes: number): string[] {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let cur = '';
  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const curBytes = Buffer.byteLength(cur, 'utf8');
    if (lineBytes > maxBytes) {
      // 单行长于上限：硬切
      if (cur) {
        chunks.push(cur);
        cur = '';
      }
      let rest = line;
      while (Buffer.byteLength(rest, 'utf8') > maxBytes) {
        let cut = maxBytes;
        while (cut > 0 && Buffer.byteLength(rest.slice(0, cut), 'utf8') > maxBytes) cut -= 8;
        chunks.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      cur = rest;
      continue;
    }
    if (curBytes + lineBytes + 1 > maxBytes && cur) {
      chunks.push(cur);
      cur = '';
    }
    cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** 解析 OneBot json 卡片描述（minimax / 掘地求生 / 红石等小游戏卡片）。 */
export function parseJsonCard(data: string | undefined): string | null {
  if (!data) return null;
  try {
    const card = JSON.parse(data);
    const prompt = card?.meta?.detail_1?.text ?? card?.prompt;
    if (typeof prompt === 'string' && prompt.trim()) return prompt.trim().slice(0, 200);
    if (Array.isArray(card?.app) === false && typeof card?.text === 'string') return card.text.slice(0, 200);
  } catch {
    /* 非 JSON，忽略 */
  }
  return null;
}

/** 事件行时间戳前缀。 */
export function eventClock(timezone: string, d: Date = new Date()): string {
  return shortTime(timezone, d);
}

export function eventTs(timezone: string, d: Date = new Date()): string {
  return nowIso(timezone, d);
}
