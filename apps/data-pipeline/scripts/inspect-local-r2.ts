/// <reference types="node" />
/**
 * Inspect local R2/D1 artifacts written by the CLI producer.
 * Run from apps/data-pipeline:
 *   pnpm exec tsx scripts/inspect-local-r2.ts
 */
import { getPlatformProxy } from 'wrangler';
import type { Env } from '../src/env.js';
import zlib from 'zlib';
import { promisify } from 'util';

const gunzip = promisify(zlib.gunzip);

async function main() {
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.cli.jsonc' });
  try {
    // List raw objects
    const rawList = await env.DATA.list({ prefix: 'raw/' });
    console.log('=== raw/ objects ===');
    for (const obj of rawList.objects) {
      console.log(' ', obj.key, `(${obj.size} bytes)`);
    }

    // List lake objects
    const lakeList = await env.DATA.list({ prefix: 'lake/' });
    console.log('\n=== lake/ objects ===');
    for (const obj of lakeList.objects) {
      console.log(' ', obj.key, `(${obj.size} bytes)`);
    }

    // List groups/r7 objects
    const groupList = await env.DATA.list({ prefix: 'groups/r7/' });
    console.log('\n=== groups/r7/ objects ===');
    console.log(`  ${groupList.objects.length} blob(s)`);
    for (const obj of groupList.objects.slice(0, 5)) {
      console.log(' ', obj.key);
    }
    if (groupList.objects.length > 5) {
      console.log(`  ... and ${groupList.objects.length - 5} more`);
    }

    // Read and decompress the lake object, show first 10 POIs
    const lakeObj = await env.DATA.get('lake/poi/penang/v1.ndjson.gz');
    if (lakeObj) {
      const buf = Buffer.from(await lakeObj.arrayBuffer());
      const text = (await gunzip(buf)).toString('utf8');
      const lines = text.trim().split('\n');
      console.log(`\n=== lake NDJSON: ${lines.length} records total ===`);
      console.log('First 15 named POIs (category, name):');
      let shown = 0;
      for (const line of lines) {
        if (shown >= 15) break;
        const rec = JSON.parse(line) as { name?: string; category?: string };
        if (rec.name) {
          console.log(`  [${rec.category ?? 'unknown'}] ${rec.name}`);
          shown++;
        }
      }

      // Per-category counts
      const counts: Record<string, number> = {};
      for (const line of lines) {
        const rec = JSON.parse(line) as { category?: string };
        const cat = rec.category ?? 'unknown';
        counts[cat] = (counts[cat] ?? 0) + 1;
      }
      console.log('\nPer-category counts:');
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      for (const [cat, n] of sorted) {
        console.log(`  ${cat}: ${n}`);
      }
    }
  } finally {
    await dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
