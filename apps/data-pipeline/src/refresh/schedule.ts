import { runRefreshSource, type RefreshEnv } from './run-refresh.js';
import { SourceSnapshotStore, type SnapshotRow } from './refresh-d1.js';
import type { RefreshSourceConfig } from './sources.js';

/**
 * A source is due when it was never run, has no parseable last-run time, or its
 * last run is at least cadenceHours old. Pure — caller supplies nowIso.
 */
export function isDue(snapshot: SnapshotRow | null, cadenceHours: number, nowIso: string): boolean {
  if (!snapshot || !snapshot.last_run_at) return true;
  const last = Date.parse(snapshot.last_run_at);
  if (Number.isNaN(last)) return true;
  const ageHours = (Date.parse(nowIso) - last) / 3_600_000;
  return ageHours >= cadenceHours;
}

export interface DueResult {
  source: string;
  ran: boolean;
}

/**
 * Refresh every due source in `sources`, sequentially, returning one
 * {source, ran} per source. `runRefresh` is injectable so tests can stub it.
 */
export async function runDueRefreshes(
  env: RefreshEnv,
  sources: Record<string, RefreshSourceConfig>,
  opts: { dataVersion: number; nowIso: string },
  runRefresh: typeof runRefreshSource = runRefreshSource,
): Promise<DueResult[]> {
  const snapshots = new SourceSnapshotStore(env.GROUPS);
  const out: DueResult[] = [];
  for (const [id, cfg] of Object.entries(sources)) {
    const snap = await snapshots.get(id);
    if (!isDue(snap, cfg.cadenceHours, opts.nowIso)) {
      out.push({ source: id, ran: false });
      continue;
    }
    await runRefresh(env, cfg.connector, cfg.mapping, {
      dataVersion: opts.dataVersion,
      nowIso: opts.nowIso,
      runId: crypto.randomUUID(),
    });
    out.push({ source: id, ran: true });
  }
  return out;
}
