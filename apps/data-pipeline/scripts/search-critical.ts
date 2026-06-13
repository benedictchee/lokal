// Verification/demo: embed a query with bge-m3, query the REAL cloud Vectorize,
// and resolve each hit against the D1 critical-info store — so you can see which
// place matched AND that the matched vector's text is the distilled critical
// information (not the bare name/category/address).
//   CLOUDFLARE_ACCOUNT_ID=... pnpm exec tsx scripts/search-critical.ts "your query"
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.js';

async function main() {
  const q = process.argv.slice(2).join(' ') || 'cosy cafe with great coffee and friendly staff';
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.sim.jsonc' });
  try {
    const rows = await env.GROUPS.prepare(
      'SELECT record_uuid, embed_text FROM place_critical_info',
    ).all<{ record_uuid: string; embed_text: string }>();
    const byId = new Map(rows.results.map((r) => [r.record_uuid, r.embed_text]));

    const emb = (await env.AI.run('@cf/baai/bge-m3', { text: [q] })) as { data: number[][] };
    const res = await env.VECTORIZE.query(emb.data[0]!, { topK: 6, returnMetadata: 'all' });

    console.log(`\nQUERY: "${q}"\n`);
    res.matches.forEach((m: any, i: number) => {
      const critical = byId.get(m.id);
      const tag = critical ? 'CRITICAL-INFO' : 'name+addr     ';
      const text = critical ? critical.slice(0, 120) : `[${m.metadata?.category ?? '?'}]`;
      console.log(`${i + 1}. ${m.score.toFixed(4)}  ${tag}  ${text}`);
    });
    console.log(`\n"CRITICAL-INFO" hits matched on distilled review facts; "name+addr" are OSM POI vectors.`);
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
