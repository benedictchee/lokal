/**
 * Browser fallback wiring.
 *
 * Every API/data connector is wrapped so that when the API path does NOT yield
 * data (needs_key / needs_license / blocked / error), it automatically falls back
 * to the source's Chrome browser-scrape strategy — when one exists and browser
 * mode is enabled (PROBE_BROWSER=1, set by `run.ts --fallback`).
 *
 * It also stamps a final `classification` describing how the source's data is
 * actually obtainable (open / api-key / api-license / browser / browser+proxy /
 * no-public-source), so the registry is self-describing for reporting.
 */
import { browserEnabled } from './browser.js';
import type {
  Classification,
  ConnectorDeps,
  ConnectorStatus,
  PullInput,
  PullResult,
  SourceConnector,
  Tier,
} from './types.js';

/**
 * API connector id → browser-strategy id, for the cases where the two pools use
 * different ids (most pair by identical id and need no entry here).
 */
export const FALLBACK_ALIASES: Record<string, string> = {
  'google-places': 'google-maps',
  'yelp-fusion': 'yelp',
  'yelp-data-licensing': 'yelp',
  'tripadvisor-content': 'tripadvisor',
  'atlas-obscura': 'atlas-obscura-web',
  'naver-local': 'naver-map',
  'naver-blog': 'naver-map',
  'expedia-rapid': 'expedia-hotels-com',
  'foursquare-places-api': 'foursquare',
  'foursquare-consumer': 'foursquare',
};

function classify(
  tier: Tier,
  apiStatus: ConnectorStatus,
  fallbackAvailable: boolean,
  br?: { status: ConnectorStatus; recordCount: number },
): Classification {
  // Tier A is open/bulk by definition. A transient error (e.g. a 503) does not
  // reclassify it — only an explicit key/licence gate does.
  if (tier === 'A') {
    if (apiStatus === 'needs_key') return 'api-key';
    if (apiStatus === 'needs_license') return 'api-license';
    return 'open';
  }
  if (br) {
    if (br.recordCount > 0 || br.status === 'ok')
      return apiStatus === 'needs_key' ? 'api-key' : apiStatus === 'needs_license' ? 'api-license' : 'browser';
    if (br.status === 'blocked') return 'browser+proxy';
    // browser ran but returned nothing / errored
    if (apiStatus === 'needs_key') return 'api-key';
    if (apiStatus === 'needs_license') return 'api-license';
    return fallbackAvailable ? 'browser+proxy' : 'no-public-source';
  }
  // browser did not run this pass
  if (apiStatus === 'needs_key') return 'api-key';
  if (apiStatus === 'needs_license') return 'api-license';
  return fallbackAvailable ? 'browser' : 'no-public-source';
}

/** Wrap one API connector with its (optional) browser fallback. */
export function withBrowserFallback(api: SourceConnector, browser?: SourceConnector): SourceConnector {
  return {
    id: api.id,
    displayName: api.displayName,
    tier: api.tier,
    coverage: api.coverage,
    plan: api.plan,
    async pull(input: PullInput, deps: ConnectorDeps): Promise<PullResult> {
      const apiRes = await api.pull(input, deps);
      const fallbackAvailable = !!browser;
      const apiHasData = apiRes.recordCount > 0 || (api.tier === 'A' && (apiRes.status === 'ok' || apiRes.status === 'partial'));

      if (apiHasData) {
        return {
          ...apiRes,
          path: api.tier === 'A' ? 'open' : 'api',
          fallbackAvailable,
          apiStatus: apiRes.status,
          classification: classify(api.tier, apiRes.status, fallbackAvailable),
        };
      }

      // API yielded no data → use the Chrome fallback if wired and enabled.
      if (browser && browserEnabled(deps.env)) {
        const br = await browser.pull(input, deps);
        return {
          ...br,
          source: api.id,
          displayName: api.displayName,
          tier: api.tier,
          path: 'browser-fallback',
          fallbackAvailable: true,
          apiStatus: apiRes.status,
          classification: classify(api.tier, apiRes.status, true, br),
          notes: [
            `API path: ${apiRes.status}${apiRes.error ? ` (${apiRes.error})` : ''} → fell back to Chrome.`,
            ...br.notes,
          ],
        };
      }

      // No fallback run this pass.
      const extra = fallbackAvailable
        ? ['Chrome fallback wired — run with --fallback (PROBE_BROWSER=1) to use it.']
        : api.tier !== 'A'
          ? ['No public website to scrape — data-provider; licence the feed for ingestion.']
          : [];
      return {
        ...apiRes,
        path: apiRes.recordCount > 0 ? 'api' : 'none',
        fallbackAvailable,
        apiStatus: apiRes.status,
        classification: classify(api.tier, apiRes.status, fallbackAvailable),
        notes: [...apiRes.notes, ...extra],
      };
    },
  };
}

/** Pair every API connector with its browser fallback (by id or alias) and wrap. */
export function pairFallbacks(apiList: SourceConnector[], browserList: SourceConnector[]): SourceConnector[] {
  const byId = new Map(browserList.map((c) => [c.id, c]));
  return apiList.map((api) => {
    const bid = byId.has(api.id) ? api.id : FALLBACK_ALIASES[api.id];
    return withBrowserFallback(api, bid ? byId.get(bid) : undefined);
  });
}
