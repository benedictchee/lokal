// Simulate a user search: embed the query with bge-m3, query the REAL cloud
// Vectorize index, then resolve the matched record_uuids to names via the lake
// (the "Vectorize-as-resolver -> fetch from R2/D1" pattern).
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.js';

async function loadNameIndex(env: Env): Promise<Map<string, { name: string; category: string }>> {
  const idx = new Map<string, { name: string; category: string }>();
  const obj = await env.DATA.get('lake/poi/penang/v1.ndjson.gz');
  if (!obj) return idx;
  const text = await new Response((obj.body as ReadableStream).pipeThrough(new DecompressionStream('gzip'))).text();
  for (const line of text.trim().split('\n')) {
    if (!line) continue;
    const r = JSON.parse(line);
    idx.set(r.record_uuid, { name: r.name, category: r.category });
  }
  return idx;
}

async function main() {
  const query = process.argv.slice(2).join(' ') || 'halal middle eastern food';
  const filterCategory = process.env.FILTER_CATEGORY; // optional metadata filter demo
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.sim.jsonc' });
  try {
    console.log(`\nQUERY: "${query}"${filterCategory ? `  (metadata filter: category=${filterCategory})` : ''}`);

    // 1) embed the query with the SAME model used at ingest
    const t0 = Date.now();
    const emb = (await env.AI.run('@cf/baai/bge-m3', { text: [query] })) as { data: number[][] };
    const vec = emb.data[0];
    console.log(`embedded -> ${vec.length}-dim vector (e.g. [${vec.slice(0, 4).map((x) => x.toFixed(4)).join(', ')}, ...])`);

    // 2) query the cloud Vectorize index
    const opts: any = { topK: 5, returnMetadata: 'all' };
    if (filterCategory) opts.filter = { category: { $eq: filterCategory } };
    const res = await env.VECTORIZE.query(vec, opts);
    const ms = Date.now() - t0;

    // 3) resolve matches -> names via the lake (Vectorize stores pointers, not payload)
    const names = await loadNameIndex(env);
    console.log(`\nTOP ${res.matches.length} MATCHES (semantic similarity, ${ms} ms incl. embedding):`);
    res.matches.forEach((m: any, i: number) => {
      const rec = names.get(m.id);
      console.log(
        `  ${i + 1}. score=${m.score.toFixed(4)}  ${rec ? rec.name : '(name not in local lake)'}` +
        `  [${m.metadata?.category}]  h3_r7=${m.metadata?.h3_r7}`,
      );
    });
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
