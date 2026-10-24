export const IMAGE_DOWNLOAD_TIMEOUT_MS = 20_000;
export const MAX_IMAGE_DOWNLOAD_BYTES = 8_000_000;

/** 超时覆盖响应头和完整响应体；按实际读取字节数限流，不先把整个文件读入内存。 */
export async function downloadImage(
  url: string,
  { timeoutMs = IMAGE_DOWNLOAD_TIMEOUT_MS, maxBytes = MAX_IMAGE_DOWNLOAD_BYTES } = {},
): Promise<Uint8Array | null> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647 ||
      !Number.isSafeInteger(maxBytes) || maxBytes < 1) return null;
  const controller = new AbortController();
  let rejectTimeout: (reason: Error) => void;
  const timeout = new Promise<never>((_, reject) => { rejectTimeout = reject; });
  const timer = setTimeout(() => {
    rejectTimeout(new Error('Image download timed out'));
    controller.abort();
  }, timeoutMs);
  let response: Response | undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    response = await Promise.race([fetch(url, { signal: controller.signal }), timeout]);
    if (!response.ok || !response.body) return null;
    const length = response.headers.get('content-length')?.trim();
    if (length && /^\d+$/.test(length) && Number(length) > maxBytes) return null;
    reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      if (value.byteLength > maxBytes - total) return null;
      total += value.byteLength;
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
    // 取消下载不应阻塞下一条消息；某些流的 cancel 自身也可能不返回。
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    } else if (response?.body) {
      void response.body.cancel().catch(() => {});
    }
  }
}
