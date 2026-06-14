import { describe, it, expect } from 'vitest';
import { gunzipToString } from '../src/pool/gzip.js';

/** gzip a string with the platform CompressionStream so the test is self-contained. */
async function gzip(s: string): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip');
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(s));
  void writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

describe('gunzipToString', () => {
  it('round-trips a gzipped UTF-8 string', async () => {
    const html = '<html><body>Café — テスト</body></html>';
    expect(await gunzipToString(await gzip(html))).toBe(html);
  });
});
