// Refine raw Google reviews into critical information: dedup (D1) -> cold-store
// new raw (R2) -> LLM extract -> store critical info (D1) -> embed + upsert (Vectorize).
//   CLOUDFLARE_ACCOUNT_ID=... pnpm exec tsx scripts/refine-reviews.ts        # all places
//   LIMIT=5 CLOUDFLARE_ACCOUNT_ID=... pnpm exec tsx scripts/refine-reviews.ts # smoke
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import {
  reviewFingerprint, criticalInfoEmbedText,
  googlePlaceToRecord, aliasFor, recordMetadata,
  type CriticalInfo, type GoogleRawPlace, type TravelRecord,
} from '@travel/pipeline-core';
import { D1GroupRegistry } from '../src/registry-d1.js';
import { D1ReviewFingerprintStore, D1CriticalInfoStore } from '../src/reviews-d1.js';
import { extractCriticalInfo } from '../src/extract-critical-info.js';
import type { Env } from '../src/env.js';

const BGE = '@cf/baai/bge-m3';
const NOW = new Date().toISOString();
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : Infinity;

async function main() {
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.sim.jsonc' });
  const fpStore = new D1ReviewFingerprintStore(env.GROUPS);
  const ciStore = new D1CriticalInfoStore(env.GROUPS);
  const groups = new D1GroupRegistry(env.GROUPS);
  try {
    const gj = JSON.parse(readFileSync(join(import.meta.dirname, 'out/google-georgetown.json'), 'utf8'));
    const places: GoogleRawPlace[] = (gj.places ?? []).slice(0, LIMIT);
    let processed = 0, embedded = 0, skipped = 0;

    for (const place of places) {
      const reviews = place.reviews ?? [];
      if (reviews.length === 0) { skipped++; continue; }

      // 1) dedup: which reviews are new for this place?
      const fps = reviews.map((r) => ({ fp: reviewFingerprint(r.author, r.text), firstSeen: NOW, review: r }));
      const fresh = await fpStore.markSeen(place.place_id, fps.map(({ fp, firstSeen }) => ({ fp, firstSeen })));
      const newReviews = fps.filter((x) => fresh.has(x.fp)).map((x) => x.review);
      if (newReviews.length === 0) { skipped++; continue; }

      // 2) cold-store the new raw reviews (R2), append-only NDJSON per place
      const coldKey = `raw/reviews/google/${place.place_id}.ndjson`;
      const prior = await env.DATA.get(coldKey);
      const priorText = prior ? await prior.text() : '';
      const appended = priorText + newReviews.map((r) => JSON.stringify({ ...r, scraped_at: place.scraped_at })).join('\n') + '\n';
      await env.DATA.put(coldKey, appended);

      // 3) normalize -> record_uuid + metadata (mirror bulk-enrich.ts)
      const norm = googlePlaceToRecord(place);
      if (!norm) { skipped++; continue; }
      const { record, signals } = norm;
      const alias = aliasFor({ subject: record.subject, category: record.category, name: record.name, record_uuid: record.record_uuid }, signals);
      const group_uuid = await groups.resolve(alias.key, { subject: record.subject, kind: alias.kind, canonical_name: alias.name });
      const full = { ...record, group_uuid } as TravelRecord;

      // 4) extract critical info (prior + new reviews)
      const existingRow = await ciStore.get(place.place_id);
      const existing: CriticalInfo | undefined = existingRow ? JSON.parse(existingRow.critical_json) : undefined;
      const ci = await extractCriticalInfo(env.AI, {
        name: record.name, category: record.category, rating: place.panel?.rating ?? null,
        existing, reviews: newReviews.map((r) => ({ stars: r.stars, text: r.text })),
      });
      if (!ci) { console.log(`  [skip] extraction failed: ${record.name}`); skipped++; continue; }

      // 5) embed the critical info -> upsert Vectorize
      const embedText = criticalInfoEmbedText(record.name, record.category, ci);
      const emb = (await env.AI.run(BGE, { text: [embedText] })) as { data: number[][] };
      await env.VECTORIZE.upsert([{ id: record.record_uuid, values: emb.data[0]!, metadata: recordMetadata(full) as Record<string, string> }]);
      embedded++;

      // 6) store critical info (D1)
      const reviewCount = (existingRow?.review_count ?? 0) + newReviews.length;
      await ciStore.put({
        place_id: place.place_id, record_uuid: record.record_uuid,
        critical_json: JSON.stringify(ci), embed_text: embedText,
        review_count: reviewCount, updated_at: NOW, last_processed_at: NOW,
      });
      processed++;
      console.log(`  ✓ ${record.name}: +${newReviews.length} new reviews -> ${Object.values(ci).flat().length} facts`);
    }
    console.log(`\nprocessed=${processed} embedded=${embedded} skipped=${skipped} / ${places.length} places (LIMIT=${LIMIT})`);
  } finally {
    await dispose();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
