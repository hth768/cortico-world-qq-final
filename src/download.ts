/** 在完整正文读完前保留超时，并按实际字节数限制内存占用。 */
export async function downloadBytes(url: string, maxBytes: number, timeoutMs: number, redirect: RequestRedirect = 'follow'): Promise<Uint8Array | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > maxBytes) {
      controller.abort();
      return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) { await reader.cancel(); return null; }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks, size);
  } catch { return null; }
  finally { clearTimeout(timer); }
}
