/** Decompress gzip bytes to a UTF-8 string using the platform DecompressionStream. */
export async function gunzipToString(bytes: Uint8Array): Promise<string> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  void writer.write(bytes);
  void writer.close();
  return await new Response(ds.readable).text();
}

/** Decode a base64 string to bytes (Workers/miniflare provide global atob). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
