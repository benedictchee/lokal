/**
 * CLI entry for the prototype scraper framework.
 *
 *   tsx scripts/connectors/run.ts <selector> [--since=ISO] [--limit=N] [--region=..] \
 *        [--last-fp=HASH] [--concurrency=N] [--verbose]
 *
 * selector: 'all' | 'tierA'..'tierE' | comma-separated connector ids
 *
 * Examples:
 *   tsx scripts/connectors/run.ts wikidata --limit=10 --verbose
 *   tsx scripts/connectors/run.ts tierA --since=2026-05-01T00:00:00Z
 *   tsx scripts/connectors/run.ts all --concurrency=6
 */
import { selectFrom, ALL_CONNECTORS, BROWSER_CONNECTORS } from './core/registry.js';
import { runConnectors } from './core/runner.js';

function arg(name: string): string | undefined {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const browserMode = flag('browser');
  const pool = browserMode ? BROWSER_CONNECTORS : ALL_CONNECTORS;
  const selector = process.argv[2];
  if (!selector || flag('list')) {
    process.stdout.write(`API/data connectors (${ALL_CONNECTORS.length}):\n`);
    for (const c of ALL_CONNECTORS) process.stdout.write(`  [${c.tier}] ${c.id.padEnd(28)} ${c.displayName}\n`);
    process.stdout.write(`\nBrowser-scrape connectors (${BROWSER_CONNECTORS.length}) — run with --browser:\n`);
    for (const c of BROWSER_CONNECTORS) process.stdout.write(`  [${c.tier}] ${c.id.padEnd(28)} ${c.displayName}\n`);
    process.stdout.write(`\nUsage: tsx scripts/connectors/run.ts <all|tierA..E|id,id> [--since=ISO] [--limit=N] [--browser] [--verbose]\n`);
    return;
  }
  const connectors = selectFrom(pool, selector);
  if (!connectors.length) {
    process.stderr.write(`No connectors matched "${selector}"${browserMode ? ' in --browser pool' : ''}. Use --list.\n`);
    process.exit(1);
  }
  if (browserMode) process.env.PROBE_BROWSER = '1'; // browser mode implies the gate
  process.stderr.write(`Running ${connectors.length} ${browserMode ? 'browser ' : ''}connector(s): ${connectors.map((c) => c.id).join(', ')}\n`);
  await runConnectors(connectors, {
    sinceTimestamp: arg('since'),
    lastSnapshotFingerprint: arg('last-fp'),
    region: arg('region'),
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    // Browser mode: sequential + human pacing between sources (no robotic parallel hammering).
    concurrency: arg('concurrency') ? Number(arg('concurrency')) : browserMode ? 1 : undefined,
    paceMs: browserMode ? Number(arg('pace') ?? 4000) : undefined,
    timeoutMs: arg('timeout') ? Number(arg('timeout')) : browserMode ? 60_000 : undefined,
    verbose: flag('verbose'),
  });
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
