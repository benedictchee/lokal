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
  // --browser  : run the pure browser-scrape pool directly.
  // --fallback : run the API pool, auto-falling back to Chrome where the API yields no data.
  const browserMode = flag('browser');
  const fallbackMode = flag('fallback');
  const pool = browserMode ? BROWSER_CONNECTORS : ALL_CONNECTORS;
  const selector = process.argv[2];
  if (!selector || flag('list')) {
    process.stdout.write(`API/data connectors (${ALL_CONNECTORS.length}) — each with a Chrome fallback where a public site exists:\n`);
    for (const c of ALL_CONNECTORS) process.stdout.write(`  [${c.tier}] ${c.id.padEnd(28)} ${c.displayName}\n`);
    process.stdout.write(`\nBrowser-scrape connectors (${BROWSER_CONNECTORS.length}) — run with --browser:\n`);
    for (const c of BROWSER_CONNECTORS) process.stdout.write(`  [${c.tier}] ${c.id.padEnd(28)} ${c.displayName}\n`);
    process.stdout.write(`\nUsage: tsx scripts/connectors/run.ts <all|tierA..E|id,id> [--since=ISO] [--limit=N] [--browser|--fallback] [--verbose]\n`);
    return;
  }
  const connectors = selectFrom(pool, selector);
  if (!connectors.length) {
    process.stderr.write(`No connectors matched "${selector}"${browserMode ? ' in --browser pool' : ''}. Use --list.\n`);
    process.exit(1);
  }
  // Both browser and fallback modes need Chrome enabled + human pacing (Chrome may launch).
  const usesBrowser = browserMode || fallbackMode;
  if (usesBrowser) process.env.PROBE_BROWSER = '1';
  process.stderr.write(`Running ${connectors.length} connector(s)${fallbackMode ? ' with Chrome fallback' : browserMode ? ' (browser pool)' : ''}: ${connectors.map((c) => c.id).join(', ')}\n`);
  await runConnectors(connectors, {
    sinceTimestamp: arg('since'),
    lastSnapshotFingerprint: arg('last-fp'),
    region: arg('region'),
    limit: arg('limit') ? Number(arg('limit')) : undefined,
    // Browser/fallback: sequential + human pacing (no robotic parallel hammering).
    concurrency: arg('concurrency') ? Number(arg('concurrency')) : usesBrowser ? 1 : undefined,
    paceMs: usesBrowser ? Number(arg('pace') ?? 4000) : undefined,
    timeoutMs: arg('timeout') ? Number(arg('timeout')) : usesBrowser ? 60_000 : undefined,
    verbose: flag('verbose'),
  });
}

main().catch((e) => {
  process.stderr.write(`fatal: ${e instanceof Error ? e.stack : String(e)}\n`);
  process.exit(1);
});
