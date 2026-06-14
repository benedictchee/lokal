/**
 * `defineConnector` — boilerplate wrapper enforcing the connector contract:
 *  - never throws (errors become status:'error' in the envelope),
 *  - stamps timing,
 *  - computes recordCount,
 *  - short-circuits when the source fingerprint matches the last snapshot.
 *
 * A connector body returns the "interesting" fields; the wrapper fills the rest.
 */
import type {
  ConnectorDeps,
  ConnectorPlan,
  ConnectorStatus,
  IncrementalCapability,
  PullInput,
  PullResult,
  PulledRecord,
  SourceConnector,
  SourceFingerprint,
  Tier,
} from './types.js';

/** What a connector body produces (the wrapper adds id/timing/counts). */
export interface PullBody {
  status: ConnectorStatus;
  sourceFingerprint: SourceFingerprint;
  incremental: IncrementalCapability;
  records?: PulledRecord[];
  cursor?: string;
  notes?: string[];
  error?: string;
  /** If the body already determined nothing changed, it can set this. */
  unchangedSinceSnapshot?: boolean;
}

export interface ConnectorDef {
  id: string;
  displayName: string;
  tier: Tier;
  coverage: string;
  plan: ConnectorPlan;
  run(input: PullInput, deps: ConnectorDeps): Promise<PullBody>;
}

export function defineConnector(def: ConnectorDef): SourceConnector {
  return {
    id: def.id,
    displayName: def.displayName,
    tier: def.tier,
    coverage: def.coverage,
    plan: def.plan,
    async pull(input: PullInput, deps: ConnectorDeps): Promise<PullResult> {
      const startedAt = new Date();
      let body: PullBody;
      try {
        body = await def.run(input, deps);
      } catch (e) {
        body = {
          status: 'error',
          sourceFingerprint: {
            method: 'none',
            value: '',
            capturedAt: startedAt.toISOString(),
          },
          incremental: { method: 'none', supported: false, description: 'run threw before producing a plan' },
          records: [],
          notes: [],
          error: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
        };
      }
      const endedAt = new Date();
      const records = body.records ?? [];
      const unchanged =
        body.unchangedSinceSnapshot ??
        (input.lastSnapshotFingerprint != null &&
          body.sourceFingerprint.value !== '' &&
          input.lastSnapshotFingerprint === body.sourceFingerprint.value);
      return {
        source: def.id,
        displayName: def.displayName,
        tier: def.tier,
        status: body.status,
        runStartedAt: startedAt.toISOString(),
        runEndedAt: endedAt.toISOString(),
        durationMs: endedAt.getTime() - startedAt.getTime(),
        sourceFingerprint: body.sourceFingerprint,
        incremental: body.incremental,
        recordCount: records.length,
        records,
        cursor: body.cursor,
        unchangedSinceSnapshot: unchanged,
        notes: body.notes ?? [],
        error: body.error,
      };
    },
  };
}
