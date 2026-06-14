/**
 * Prototype scraper framework — uniform interfaces.
 *
 * Goal (exploratory): for every catalogued source, answer two questions with a
 * runnable experiment:
 *   1. Is pulling data doable? (real fetch / probe — if it fails we drill in later)
 *   2. Can we cheaply produce a SOURCE FINGERPRINT + delta method so we only
 *      ingest new/updated info since a prior snapshot, avoiding full re-pulls?
 *
 * Every connector shares ONE trigger interface (`pull`) and ONE output envelope
 * (`PullResult`). The framework deliberately sits ON TOP of the repo's existing
 * pipeline-core primitives — `TravelRecord`, `fnv1a` (content hash), and
 * `recordUuid` — so a promising connector can graduate into the real pipeline
 * without re-modelling its output.
 *
 * PROTOTYPE NOTE: PullInput is intentionally loose. Production will REQUIRE
 * `sinceTimestamp` (the "last_snapshot_timestamp"); here every field is optional
 * so we can run a connector cold.
 */

/** License/access tier from the source catalog (docs/research/...). */
export type Tier = 'A' | 'B' | 'C' | 'D' | 'E';

/** Outcome of a single connector run — the headline of every experiment. */
export type ConnectorStatus =
  | 'ok' // real data pulled and parsed
  | 'partial' // some data pulled, with caveats (see notes)
  | 'needs_key' // method implemented; requires an API key/credential to run
  | 'needs_license' // requires a paid data license / signed partner agreement
  | 'blocked' // no sanctioned access; probe demonstrates the wall (anti-bot, etc.)
  | 'error'; // unexpected failure (see error)

/**
 * How a source supports "give me only what changed since T".
 * `method` is the mechanism; `supported` says whether it's usable in practice.
 */
export interface IncrementalCapability {
  method:
    | 'api-since-param' // endpoint takes a since/updated_after parameter
    | 'changes-feed' // recent-changes stream / replication diff (OSM, MediaWiki)
    | 'dump-diff' // periodic bulk dump + published delta/diff files
    | 'sort-by-updated' // list sorted by recency; stop when older than T
    | 'etag-conditional' // If-None-Match / If-Modified-Since on a resource
    | 'sitemap-lastmod' // sitemap.xml <lastmod> per URL → cheap change set
    | 'cursor-pagination' // opaque cursor that can be resumed across runs
    | 'full-only' // no delta mechanism; must re-pull and diff by hash
    | 'none'; // could not determine any mechanism
  supported: boolean;
  /** How delta works for THIS source, concretely. */
  description: string;
  /** The timestamp actually applied this run, if any. */
  sinceApplied?: string;
}

/**
 * Identifies the STATE of a source so we can answer "did anything change since
 * the last snapshot?" cheaply, without re-pulling. Method is customised per
 * source. For sources with no timestamp, this carries the heuristic (e.g. a
 * hash of the result-count + the top-N newest IDs, or a sitemap lastmod max).
 */
export interface SourceFingerprint {
  /**
   * The fingerprinting strategy, e.g.:
   *  'release-date' | 'etag' | 'last-modified' | 'planet-sequence' |
   *  'replication-state' | 'max-dateModified' | 'count+newest-ids' |
   *  'sitemap-lastmod-max' | 'dump-md5' | 'content-hash'
   */
  method: string;
  /** The fingerprint value — compare to PullInput.lastSnapshotFingerprint. */
  value: string;
  /** What went into the fingerprint (for debugging / explainability). */
  components?: Record<string, string | number>;
  capturedAt: string; // ISO 8601
}

/** A single pulled item. Mirrors the keys pipeline-core uses for identity/delta. */
export interface PulledRecord {
  /** Native ID within the source. */
  source_id: string;
  /** Stable idempotent id: recordUuid(connector.id, source_id). */
  record_uuid: string;
  /** fnv1a hash of the canonical content → per-record delta key (dedup elsewhere). */
  content_hash: string;
  /** Source-reported last-update, if the source exposes one. */
  updated_at?: string;
  name?: string;
  lat?: number;
  lng?: number;
  /** Raw payload (trimmed in prototype to keep output files small). */
  raw?: unknown;
}

/**
 * PROTOTYPE trigger input. All optional now; `sinceTimestamp` becomes mandatory
 * in production (the "last_snapshot_timestamp" contract).
 */
export interface PullInput {
  /** ISO 8601 — pull new/updated records on/after this instant (best effort). */
  sinceTimestamp?: string;
  /** Prior run's SourceFingerprint.value — lets a connector short-circuit if unchanged. */
  lastSnapshotFingerprint?: string;
  /** Opaque per-source resume cursor from a prior run. */
  cursor?: string;
  /** Cap records pulled — keeps prototype runs cheap. */
  limit?: number;
  /** Optional geographic scope hint (bbox/region name); source-specific. */
  region?: string;
}

/** Injected runtime — keeps connectors testable and key-aware. */
export interface ConnectorDeps {
  fetch: typeof fetch;
  /** Environment (API keys etc.), read from process.env by the runner. */
  env: Record<string, string | undefined>;
  log: (msg: string) => void;
  /** Per-connector wall-clock budget; connectors should respect it. */
  timeoutMs: number;
}

/**
 * Final classification of how a source's data is actually obtainable, after the
 * API path AND the Chrome fallback have been considered:
 *  - open           — pull directly, no credentials (Tier A open/bulk)
 *  - api-key        — API works with a key; a Chrome fallback is also wired
 *  - api-license    — API behind a paid/partner licence; Chrome fallback wired
 *  - browser        — no usable public API; Chrome scrape works
 *  - browser+proxy  — Chrome reaches it but a WAF needs a residential proxy/unblocker
 *  - no-public-source — no public API AND no public website (pure data provider) → licence the feed
 */
export type Classification =
  | 'open'
  | 'api-key'
  | 'api-license'
  | 'browser'
  | 'browser+proxy'
  | 'no-public-source';

/** Which path produced the returned records. */
export type DataPath = 'open' | 'api' | 'browser-fallback' | 'none';

/** The uniform OUTPUT envelope every connector returns. */
export interface PullResult {
  source: string; // connector id
  displayName: string;
  tier: Tier;
  status: ConnectorStatus;
  runStartedAt: string;
  runEndedAt: string;
  durationMs: number;
  /** The source-state fingerprint for snapshot-level dedup / change detection. */
  sourceFingerprint: SourceFingerprint;
  /** The chosen delta mechanism, applied this run where possible. */
  incremental: IncrementalCapability;
  recordCount: number;
  records: PulledRecord[];
  /** Resume cursor for the next run, if the source supports it. */
  cursor?: string;
  /** True if sourceFingerprint matched input.lastSnapshotFingerprint (no work needed). */
  unchangedSinceSnapshot?: boolean;
  /** Human-readable findings — especially WHY a source is blocked/needs_key. */
  notes: string[];
  error?: string;
  // --- Set by the browser-fallback wrapper (core/fallback.ts) ---
  /** Which path produced records this run. */
  path?: DataPath;
  /** Whether a Chrome fallback strategy is wired for this source. */
  fallbackAvailable?: boolean;
  /** Original API-path status, retained when the browser fallback supersedes it. */
  apiStatus?: ConnectorStatus;
  /** Final how-to-get-the-data classification. */
  classification?: Classification;
}

/** Static, declared plan for a source — the "method" half of the experiment. */
export interface ConnectorPlan {
  /** How we access it: open dump / public API / API key / scrape / license. */
  access: string;
  /** Chosen incremental-pull approach in one line. */
  incremental: string;
  /** Chosen fingerprint approach in one line (esp. the heuristic for no-timestamp sources). */
  fingerprint: string;
}

/** The single interface every source implements. */
export interface SourceConnector {
  id: string; // kebab-case, e.g. 'foursquare-os-places'
  displayName: string;
  tier: Tier;
  /** Region/language coverage one-liner (from catalog). */
  coverage: string;
  plan: ConnectorPlan;
  /** Uniform trigger. MUST resolve to a PullResult even on failure (never throw). */
  pull(input: PullInput, deps: ConnectorDeps): Promise<PullResult>;
}
