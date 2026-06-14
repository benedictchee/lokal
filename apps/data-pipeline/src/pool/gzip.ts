/**
 * Decompress gzip bytes to a UTF-8 string using the platform DecompressionStream.
 * Reads incrementally and throws if the inflated size exceeds `maxBytes`
 * (a decompression-bomb guard). Default is unbounded.
 */
export async function gunzipToString(bytes: Uint8Array, maxBytes = Number.POSITIVE_INFINITY): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('gunzip: decompressed payload exceeds cap');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(out);
}

/** Decode a base64 string to bytes (Workers/miniflare provide global atob). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
