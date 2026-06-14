/**
 * Uniform runner — the single trigger surface for every connector.
 *
 * Runs one/many connectors with a per-connector timeout, writes each uniform
 * PullResult to out/<id>.json, and prints a summary matrix. One connector
 * failing never aborts the batch (the wrapper guarantees a PullResult).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PullInput, PullResult, SourceConnector } from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'out');

const DEFAULT_TIMEOUT_MS = 45_000;
/** How many records to keep in the written file (full set is counted regardless). */
const SAVE_RECORD_SAMPLE = 25;

export interface RunOptions extends PullInput {
  timeoutMs?: number;
  /** Run connectors concurrently up to this many at a time. */
  concurrency?: number;
  /** Print per-connector notes in the console summary. */
  verbose?: boolean;
  /** Human-like pause between connectors in a worker (ms) — used for browser mode. */
  paceMs?: number;
}

export async function runConnectors(
  connectors: SourceConnector[],
  opts: RunOptions = {},
): Promise<PullResult[]> {
  mkdirSync(OUT_DIR, { recursive: true });
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const concurrency = opts.concurrency ?? 5;
  const input: PullInput = {
    sinceTimestamp: opts.sinceTimestamp,
    lastSnapshotFingerprint: opts.lastSnapshotFingerprint,
    cursor: opts.cursor,
    limit: opts.limit ?? 25,
    region: opts.region,
  };

  const results: PullResult[] = [];
  const queue = [...connectors];

  async function worker() {
    for (;;) {
      const c = queue.shift();
      if (!c) return;
      const deps = {
        fetch: globalThis.fetch,
        env: process.env as Record<string, string | undefined>,
        log: (m: string) => process.stderr.write(`  [${c.id}] ${m}\n`),
        timeoutMs,
      };
      // Hard outer guard so a runaway connector can't hang the batch.
      const guard = new Promise<PullResult>((resolve) =>
        setTimeout(
          () =>
            resolve({
              source: c.id,
              displayName: c.displayName,
              tier: c.tier,
              status: 'error',
              runStartedAt: new Date().toISOString(),
              runEndedAt: new Date().toISOString(),
              durationMs: timeoutMs,
              sourceFingerprint: { method: 'none', value: '', capturedAt: new Date().toISOString() },
              incremental: { method: 'none', supported: false, description: 'outer timeout' },
              recordCount: 0,
              records: [],
              notes: [`outer runner timeout after ${timeoutMs}ms`],
              error: 'TimeoutError: connector exceeded outer guard',
            }),
          timeoutMs + 5_000,
        ),
      );
      const res = await Promise.race([c.pull(input, deps), guard]);
      // Persist a trimmed copy (full recordCount preserved; records sampled).
      const onDisk: PullResult = {
        ...res,
        records: res.records.slice(0, SAVE_RECORD_SAMPLE),
      };
      writeFileSync(join(OUT_DIR, `${c.id}.json`), JSON.stringify(onDisk, null, 2));
      results.push(res);
      // Human-like pause between sources (browser mode) so we don't hammer.
      if (opts.paceMs && queue.length) await new Promise((r) => setTimeout(r, opts.paceMs));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  // Keep registry order for a stable matrix.
  const order = new Map(connectors.map((c, i) => [c.id, i]));
  results.sort((a, b) => (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0));
  printMatrix(results, opts.verbose ?? false);
  writeFileSync(join(OUT_DIR, '_summary.json'), JSON.stringify(summarize(results), null, 2));
  return results;
}

const STATUS_ICON: Record<string, string> = {
  ok: '🟢 ok',
  partial: '🟡 partial',
  needs_key: '🔑 needs_key',
  needs_license: '📄 needs_license',
  blocked: '🔴 blocked',
  error: '💥 error',
};

function printMatrix(results: PullResult[], verbose: boolean) {
  const rows = results.map((r) => ({
    tier: r.tier,
    id: r.source,
    status: STATUS_ICON[r.status] ?? r.status,
    recs: String(r.recordCount),
    incr: `${r.incremental.supported ? '✓' : '✗'} ${r.incremental.method}`,
    fp: r.sourceFingerprint.method,
    ms: String(r.durationMs),
  })) as Array<Record<string, string>>;
  const cols: Array<[keyof (typeof rows)[number] | string, string]> = [
    ['tier', 'TIER'],
    ['id', 'CONNECTOR'],
    ['status', 'STATUS'],
    ['recs', 'RECS'],
    ['incr', 'INCREMENTAL'],
    ['fp', 'FINGERPRINT'],
    ['ms', 'MS'],
  ];
  const widths = cols.map(([k, h]) => Math.max(h.length, ...results.map((_, i) => (rows[i]![k as string] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  process.stdout.write('\n' + line(cols.map(([, h]) => h)) + '\n');
  process.stdout.write(widths.map((w) => '-'.repeat(w)).join('  ') + '\n');
  for (const row of rows) process.stdout.write(line(cols.map(([k]) => row[k as string] ?? '')) + '\n');
  if (verbose) {
    process.stdout.write('\n=== notes ===\n');
    for (const r of results) {
      if (r.notes.length || r.error) {
        process.stdout.write(`\n[${r.source}] ${r.status}\n`);
        for (const n of r.notes) process.stdout.write(`  - ${n}\n`);
        if (r.error) process.stdout.write(`  ! ${r.error}\n`);
      }
    }
  }
  const sum = summarize(results);
  process.stdout.write(
    `\n${results.length} connectors | ` +
      Object.entries(sum.byStatus)
        .map(([k, v]) => `${k}:${v}`)
        .join('  ') +
      `  | incremental-supported:${sum.incrementalSupported}\n`,
  );
}

export function summarize(results: PullResult[]) {
  const byStatus: Record<string, number> = {};
  for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return {
    total: results.length,
    byStatus,
    incrementalSupported: results.filter((r) => r.incremental.supported).length,
    totalRecords: results.reduce((a, r) => a + r.recordCount, 0),
    generatedAt: new Date().toISOString(),
  };
}
