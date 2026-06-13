// Bulk-enrich: read records (a local lake NDJSON, or the Google scrape), embed
// each via the cloud bge-m3, and upsert to the cloud Vectorize index. Used to
// load the COMPLETE local dataset into cloud Vectorize without the queue path.
//   tsx scripts/bulk-enrich.ts --lake lake/poi/penang-island/v1.ndjson.gz
//   tsx scripts/bulk-enrich.ts --google
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  composeEmbedText, recordMetadata, googlePlaceToRecord, aliasFor, InMemoryGroupRegistry,
  type TravelRecord,
} from '@travel/pipeline-core';
import type { Env } from '../src/env.js';

const BGE = '@cf/baai/bge-m3';
const EMBED_BATCH = 50;   // texts per AI.run call
const UPSERT_BATCH = 500; // vectors per Vectorize.upsert call

type Item = { id: string; text: string; metadata: Record<string, string> };

async function lakeItems(env: Env, key: string): Promise<Item[]> {
  const obj = await env.DATA.get(key);
  if (!obj) throw new Error(`no lake object at ${key}`);
  const text = await new Response((obj.body as ReadableStream).pipeThrough(new DecompressionStream('gzip'))).text();
  return text.trim().split('\n').filter(Boolean).map((l) => {
    const r = JSON.parse(l) as TravelRecord;
    return { id: r.record_uuid, text: composeEmbedText(r), metadata: recordMetadata(r) as Record<string, string> };
  });
}

async function googleItems(): Promise<Item[]> {
  const gj = JSON.parse(readFileSync(join(import.meta.dirname, 'out/google-georgetown.json'), 'utf8'));
  const reg = new InMemoryGroupRegistry();
  const items: Item[] = [];
  for (const place of gj.places ?? []) {
    const n = googlePlaceToRecord(place);
    if (!n) continue;
    const { record, signals } = n;
    const alias = aliasFor(
      { subject: record.subject, category: record.category, name: record.name, record_uuid: record.record_uuid },
      signals,
    );
    const group_uuid = await reg.resolve(alias.key, { subject: record.subject, kind: alias.kind, canonical_name: alias.name });
    const full = { ...record, group_uuid } as TravelRecord;
    items.push({ id: full.record_uuid, text: composeEmbedText(full), metadata: recordMetadata(full) as Record<string, string> });
  }
  return items;
}

async function main() {
  const args = process.argv.slice(2);
  const lakeKey = args.includes('--lake') ? args[args.indexOf('--lake') + 1] : undefined;
  const isGoogle = args.includes('--google');

  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.sim.jsonc' });
  try {
    const items = isGoogle ? await googleItems() : await lakeItems(env, lakeKey!);
    console.log(`source=${isGoogle ? 'google' : lakeKey}  items=${items.length}`);

    // embed in batches
    const vectors: { id: string; values: number[]; metadata: Record<string, string> }[] = [];
    for (let i = 0; i < items.length; i += EMBED_BATCH) {
      const batch = items.slice(i, i + EMBED_BATCH);
      const res = (await env.AI.run(BGE, { text: batch.map((b) => b.text) })) as { data: number[][] };
      batch.forEach((b, k) => vectors.push({ id: b.id, values: res.data[k]!, metadata: b.metadata }));
      if ((i / EMBED_BATCH) % 10 === 0) console.log(`  embedded ${Math.min(i + EMBED_BATCH, items.length)}/${items.length}`);
    }

    // upsert in batches
    let up = 0;
    for (let i = 0; i < vectors.length; i += UPSERT_BATCH) {
      const slice = vectors.slice(i, i + UPSERT_BATCH);
      await env.VECTORIZE.upsert(slice);
      up += slice.length;
    }
    console.log(`upserted ${up} vectors to cloud Vectorize`);
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
