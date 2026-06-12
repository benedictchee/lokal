/// <reference types="node" />
/**
 * M3 — GTFS transport ingest for Rapid Bus Penang (MVP).
 *
 * Fetches the live GTFS static feed (redirect-following), unzips it, parses
 * stops.txt, normalises each stop via gtfsStopToRecord, resolves the shared
 * bus group_uuid via InMemoryGroupRegistry, writes a gzipped NDJSON lake
 * object to local R2 (via wrangler getPlatformProxy), and prints a summary.
 *
 * Usage (from apps/data-pipeline):
 *   pnpm ingest:gtfs              # default --limit 50
 *   pnpm ingest:gtfs --limit 200
 *   pnpm ingest:gtfs --limit 0   # all stops (1921)
 */

import { getPlatformProxy } from 'wrangler';
import AdmZip from 'adm-zip';
import { parse as csvParse } from 'csv-parse/sync';
import type { Env } from '../src/env.js';
import {
  gtfsStopToRecord,
  type GtfsStop,
  aliasFor,
  InMemoryGroupRegistry,
  NdjsonR2LakeWriter,
  buildGroupBlobs,
  type TravelRecord,
} from '@travel/pipeline-core';

// ── Config ─────────────────────────────────────────────────────────────────
const FEED_URL = 'https://api.data.gov.my/gtfs-static/prasarana?category=rapid-bus-penang';
const SOURCE = 'gtfs-rapid-bus-penang';
const CATEGORY = 'bus';
const REGION = 'penang-bus';
const DATA_VERSION = 1;

// ── CLI arg: --limit N (default 50, 0 = all) ───────────────────────────────
function parseLimit(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && process.argv[idx + 1] !== undefined) {
    return parseInt(process.argv[idx + 1]!, 10);
  }
  return 50;
}

// ── Fetch with redirect-following ──────────────────────────────────────────
async function fetchZip(url: string): Promise<Buffer> {
  console.log(`[gtfs] Fetching ${url} …`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`[gtfs] Downloaded ${(buf.length / 1024).toFixed(0)} KB`);
  return buf;
}

// ── Parse stops.txt from ZIP ────────────────────────────────────────────────
function parseStops(zipBuf: Buffer): GtfsStop[] {
  const zip = new AdmZip(zipBuf);
  const entry = zip.getEntry('stops.txt');
  if (!entry) throw new Error('stops.txt not found in GTFS ZIP');
  const raw = entry.getData().toString('utf8');
  // columns:true → object rows keyed by header; bom:true strips UTF-8 BOM if present
  return csvParse(raw, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
  }) as GtfsStop[];
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  const limit = parseLimit();
  console.log(`[gtfs] limit=${limit === 0 ? 'ALL' : limit}`);

  const zipBuf = await fetchZip(FEED_URL);
  const allStops = parseStops(zipBuf);
  console.log(`[gtfs] stops.txt: ${allStops.length} rows`);

  const stops = limit > 0 ? allStops.slice(0, limit) : allStops;
  console.log(`[gtfs] Processing ${stops.length} stops …`);

  const registry = new InMemoryGroupRegistry();
  const records: TravelRecord[] = [];
  let skipped = 0;

  for (const stop of stops) {
    const out = gtfsStopToRecord(stop, {
      source: SOURCE,
      category: CATEGORY,
      sourceUrl: FEED_URL,
    });
    if (!out) { skipped++; continue; }

    const { record, signals } = out;
    const alias = aliasFor(record, signals);
    const group_uuid = await registry.resolve(alias.key, {
      subject: record.subject,
      kind: alias.kind,
      canonical_name: alias.name,
    });

    records.push({
      ...record,
      group_uuid,
      data_version: DATA_VERSION,
      raw_r2_key: `raw/${SOURCE}/${record.source_id}`,
    });
  }

  console.log(`[gtfs] Normalised: ${records.length} records, ${skipped} skipped`);

  // Distinct group_uuids (should be exactly 1 for a single-category bus feed)
  const distinctGroups = new Set(records.map((r) => r.group_uuid));
  console.log(`[gtfs] Distinct group_uuid count: ${distinctGroups.size}`);
  if (distinctGroups.size !== 1) {
    console.warn('[gtfs] WARNING: expected exactly 1 group_uuid for a single-category feed');
  }
  const sharedGroupUuid = [...distinctGroups][0]!;
  console.log(`[gtfs] Shared group_uuid: ${sharedGroupUuid}`);

  // 3 sample records
  console.log('\n[gtfs] Sample records (first 3):');
  for (const r of records.slice(0, 3)) {
    console.log(JSON.stringify({
      record_uuid: r.record_uuid,
      subject: r.subject,
      category: r.category,
      name: r.name,
      lat: r.lat,
      lng: r.lng,
      group_uuid: r.group_uuid,
      h3_r7: r.h3_r7,
    }, null, 2));
  }

  // Write to local R2 lake via getPlatformProxy
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.cli.jsonc' });
  try {
    const writer = new NdjsonR2LakeWriter(env.DATA);
    await writer.append(records, { source: SOURCE, region: REGION, dataVersion: DATA_VERSION });
    const lakeKey = `lake/transport/${REGION}/v${DATA_VERSION}.ndjson.gz`;
    console.log(`\n[gtfs] Lake object written: ${lakeKey}`);

    // Verify it's there
    const obj = await env.DATA.get(lakeKey);
    if (!obj) throw new Error('Lake object not found after write — something went wrong');
    console.log(`[gtfs] Lake object confirmed: ${obj.size} bytes (gzipped)`);

    // Write group blobs for serving layer
    const blobs = buildGroupBlobs(records, DATA_VERSION);
    for (const blob of blobs) {
      await env.DATA.put(blob.key, blob.body);
    }
    console.log(`[gtfs] Group blobs written: ${blobs.length} r7 cells`);

    // Summary
    console.log('\n=== M3 GTFS INGEST SUMMARY ===');
    console.log(`  Records:           ${records.length}`);
    console.log(`  Skipped:           ${skipped}`);
    console.log(`  Distinct groups:   ${distinctGroups.size} (should be 1)`);
    console.log(`  Shared group_uuid: ${sharedGroupUuid}`);
    console.log(`  Lake key:          ${lakeKey}`);
    console.log(`  Group blobs:       ${blobs.length} r7 cells`);
    console.log('  subject=transport, category=bus for ALL records');
    console.log('==============================');
  } finally {
    await dispose();
  }
}

main().catch((e) => {
  console.error('[gtfs] FATAL:', e);
  process.exit(1);
});
