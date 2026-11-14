import sharp from 'sharp';
import type { BlobInput } from 'cortico/core/types.ts';

/** 统一图片编码；长图分为最多四张连续画面，避免供应商拒绝超长尺寸。 */
export async function imageAttachments(bytes: Uint8Array, name: string): Promise<BlobInput[]> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 64 * 1024 * 1024, animated: false })
    .rotate().resize({ width: 2048, height: 8192, fit: 'inside', withoutEnlargement: true })
    .png().toBuffer({ resolveWithObject: true });
  const blobs: BlobInput[] = [];
  for (let top = 0; top < info.height; top += 2048) {
    const part = await sharp(data).extract({ left: 0, top, width: info.width, height: Math.min(2048, info.height - top) })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer();
    blobs.push({ bytes: part, mime: 'image/jpeg', name: `${name}-${blobs.length + 1}`, fallbackText: `[图片第 ${blobs.length + 1} 部分，按从上到下顺序]` });
  }
  return blobs;
}
