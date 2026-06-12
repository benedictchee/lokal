/// <reference types="node" />
/**
 * Bootstrap the Vectorize index for the data pipeline.
 *
 * MUST run BEFORE any enrich upsert: metadata indexes can only be created on
 * an index that has no conflicting vectors, and queries filter on these
 * fields. bge-m3 emits 1024-dim vectors; metric cosine (spec §5.1).
 *
 * Run:  pnpm --filter @travel/data-pipeline bootstrap:vectorize
 * (add to apps/data-pipeline/package.json scripts in Task 9 wiring, or invoke
 *  the equivalent wrangler commands below by hand.)
 *
 * Equivalent manual wrangler commands (idempotent: re-running create on an
 * existing index/property errors harmlessly — safe to ignore "already exists"):
 *
 *   wrangler vectorize create travel-records --dimensions=1024 --metric=cosine
 *   wrangler vectorize create-metadata-index travel-records --property-name=subject    --type=string
 *   wrangler vectorize create-metadata-index travel-records --property-name=category   --type=string
 *   wrangler vectorize create-metadata-index travel-records --property-name=group_uuid --type=string
 *   wrangler vectorize create-metadata-index travel-records --property-name=h3_r5      --type=string
 *   wrangler vectorize create-metadata-index travel-records --property-name=h3_r7      --type=string
 *   wrangler vectorize create-metadata-index travel-records --property-name=h3_r10     --type=string
 */
import { spawnSync } from 'node:child_process';

const INDEX = 'travel-records';
const DIMENSIONS = 1024;
const METRIC = 'cosine';
// The 6 string metadata indexes (pointers, not payload) — created BEFORE upsert.
const METADATA_PROPERTIES = ['subject', 'category', 'group_uuid', 'h3_r5', 'h3_r7', 'h3_r10'] as const;

function wrangler(args: string[]): void {
  const printable = ['wrangler', ...args].join(' ');
  console.log(`$ ${printable}`);
  const res = spawnSync('wrangler', args, { stdio: 'inherit' });
  if (res.error) throw res.error;
  // Exit code != 0 is tolerated for "already exists" idempotency; surface it.
  if (res.status !== 0) {
    console.warn(`  (exit ${res.status}) — continuing; treat "already exists" as OK`);
  }
}

function main(): void {
  wrangler(['vectorize', 'create', INDEX, `--dimensions=${DIMENSIONS}`, `--metric=${METRIC}`]);
  for (const property of METADATA_PROPERTIES) {
    wrangler(['vectorize', 'create-metadata-index', INDEX, `--property-name=${property}`, '--type=string']);
  }
  console.log(`Bootstrapped Vectorize index "${INDEX}" (${DIMENSIONS}d/${METRIC}) with ${METADATA_PROPERTIES.length} string metadata indexes.`);
}

main();
