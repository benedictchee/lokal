import { getPlatformProxy } from 'wrangler';
import type { Env, IngestParams } from './env.js';

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a !== undefined && a.startsWith('--')) {
      out[a.slice(2)] = argv[++i] ?? '';
    }
  }
  return out;
}

// Local StepLike: run inline, no durable retry semantics needed for the CLI.
function localStep() {
  return {
    do: async (_name: string, a: unknown, b?: unknown) => {
      const cb = (typeof a === 'function' ? a : b) as () => Promise<unknown>;
      return cb();
    },
    sleep: async () => {},
    sleepUntil: async () => {},
  };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'ingest') {
    console.error('usage: ingest --source osm --region <id> --bbox a,b,c,d --data-version <n>');
    process.exit(1);
  }
  const args = parseArgs(rest);
  const bboxStr = args['bbox'] ?? '';
  const bbox = bboxStr.split(',').map(Number) as [number, number, number, number];
  if (bbox.length !== 4 || bbox.some(Number.isNaN)) {
    console.error('--bbox must be 4 comma-separated numbers: a,b,c,d');
    process.exit(1);
  }
  const region = args['region'] ?? '';
  // Fix 7: Number('') === 0 (not NaN), so check explicitly for missing/empty before converting.
  const dvRaw = args['data-version'];
  if (!dvRaw) {
    console.error('--data-version is required');
    process.exit(1);
  }
  const dataVersion = Number(dvRaw);
  if (Number.isNaN(dataVersion)) {
    console.error('--data-version must be a number');
    process.exit(1);
  }
  if (!region) {
    console.error('--region is required');
    process.exit(1);
  }
  const params: IngestParams = {
    source: args['source'] ?? 'osm',
    region,
    bbox,
    dataVersion,
  };

  // Import from run-ingest.ts which has no cloudflare:* imports — Node-clean.
  const { runIngest } = await import('./run-ingest.js');
  // wrangler.cli.jsonc omits workflows/vectorize/ai which Miniflare cannot
  // serve locally creds-free; the producer only needs DATA/GROUPS/ENRICH.
  const { env, dispose } = await getPlatformProxy<Env>({ configPath: 'wrangler.cli.jsonc' });
  try {
    const summary = await runIngest(env, { payload: params }, localStep());
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
