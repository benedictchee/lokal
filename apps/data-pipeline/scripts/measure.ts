// Measure what's stored at each pipeline stage + compression efficiency (local R2).
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.js';

async function inflatedSize(stream: ReadableStream): Promise<{ text: string; bytes: number }> {
  const text = await new Response(stream.pipeThrough(new DecompressionStream('gzip'))).text();
  return { text, bytes: Buffer.byteLength(text, 'utf8') };
}
const kb = (n: number) => (n / 1024).toFixed(1) + ' KB';

async function listAll(env: Env, prefix: string) {
  const out: { key: string; size: number }[] = [];
  let cursor: string | undefined;
  do {
    const r = await env.DATA.list({ prefix, cursor, limit: 1000 });
    for (const o of r.objects) out.push({ key: o.key, size: o.size });
    cursor = r.truncated ? r.cursor : undefined;
  } while (cursor);
  return out;
}

async function main() {
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.cli.jsonc' });
  try {
    const report: any = { lakes: [], raw: {}, blobs: {} };

    // --- Lake (NDJSON.gz): stored gz vs inflated NDJSON => compression ratio ---
    const lakeObjs = await listAll(env, 'lake/');
    for (const o of lakeObjs) {
      const obj = await env.DATA.get(o.key);
      const { text, bytes } = await inflatedSize(obj!.body as ReadableStream);
      const records = text.trim().split('\n').filter(Boolean).length;
      report.lakes.push({
        key: o.key, records,
        storedGz: o.size, ndjson: bytes,
        ratio: (bytes / o.size).toFixed(1) + 'x',
        savedPct: (100 * (1 - o.size / bytes)).toFixed(1) + '%',
        bytesPerRecordGz: Math.round(o.size / records),
      });
    }

    // --- Raw landing ---
    const rawObjs = await listAll(env, 'raw/');
    report.raw = { count: rawObjs.length, totalBytes: rawObjs.reduce((s, o) => s + o.size, 0), keys: rawObjs.map((o) => `${o.key} (${kb(o.size)})`) };

    // --- r7 cold blobs ---
    const blobObjs = await listAll(env, 'groups/r7/');
    report.blobs = { count: blobObjs.length, totalBytes: blobObjs.reduce((s, o) => s + o.size, 0) };

    // pretty print
    console.log('\n=== LAKE (NDJSON.gz) — stored vs processed + compression ===');
    for (const l of report.lakes) {
      console.log(`${l.key}`);
      console.log(`  records=${l.records}  ndjson=${kb(l.ndjson)} -> gz=${kb(l.storedGz)}  (${l.ratio} smaller, ${l.savedPct} saved, ${l.bytesPerRecordGz} B/record)`);
    }
    console.log('\n=== RAW landing ===');
    console.log(`  ${report.raw.count} objects, ${kb(report.raw.totalBytes)} total`);
    report.raw.keys.forEach((k: string) => console.log('   ' + k));
    console.log('\n=== r7 COLD BLOBS (groups/r7/) ===');
    console.log(`  ${report.blobs.count} blobs, ${kb(report.blobs.totalBytes)} total`);
    console.log('\nJSON:'); console.log(JSON.stringify(report, null, 0));
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
