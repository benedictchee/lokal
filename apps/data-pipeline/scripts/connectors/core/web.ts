/**
 * Small web helpers reused by connectors: S3 anonymous listing, SPARQL SELECT,
 * and MediaWiki recent-changes. Kept dependency-free (regex/JSON only).
 */
import { fetchT, UA } from './fingerprint.js';

/**
 * List "directories" (CommonPrefixes) and keys under an anonymous S3 bucket via
 * the REST ListObjectsV2 XML API. Used to discover the latest release partition
 * of open bulk datasets (Foursquare OS Places, Overture) — the cheapest possible
 * source fingerprint (no data download).
 */
export async function s3List(
  fetchFn: typeof fetch,
  httpsBase: string, // e.g. https://fsq-os-places-us-east-1.s3.amazonaws.com
  prefix: string,
  timeoutMs = 20_000,
): Promise<{ prefixes: string[]; keys: string[] }> {
  const url = `${httpsBase}/?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=${encodeURIComponent('/')}`;
  const res = await fetchT(fetchFn, url, { headers: { 'User-Agent': UA }, timeoutMs });
  const xml = await res.text();
  const prefixes = [...xml.matchAll(/<Prefix>([^<]+)<\/Prefix>/g)]
    .map((m) => m[1]!)
    .filter((p) => p !== prefix);
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
  return { prefixes: [...new Set(prefixes)], keys };
}

/** Run a SPARQL SELECT and return the JSON bindings array. */
export async function sparqlSelect(
  fetchFn: typeof fetch,
  endpoint: string,
  query: string,
  timeoutMs = 30_000,
): Promise<Array<Record<string, { value: string; type: string }>>> {
  const url = `${endpoint}?query=${encodeURIComponent(query)}&format=json`;
  const res = await fetchT(fetchFn, url, {
    headers: { Accept: 'application/sparql-results+json', 'User-Agent': UA },
    timeoutMs,
  });
  const json = (await res.json()) as { results?: { bindings?: Array<Record<string, { value: string; type: string }>> } };
  return json.results?.bindings ?? [];
}

/** MediaWiki recent-changes (the changes-feed delta for Wikipedia/Wikivoyage). */
export async function mwRecentChanges(
  fetchFn: typeof fetch,
  apiBase: string, // e.g. https://en.wikipedia.org/w/api.php
  opts: { since?: string; limit?: number; timeoutMs?: number } = {},
): Promise<{ changes: Array<{ pageid: number; title: string; timestamp: string; revid: number; type: string }>; latest: string | null }> {
  const params = new URLSearchParams({
    action: 'query',
    list: 'recentchanges',
    rcnamespace: '0',
    rcprop: 'title|ids|timestamp|loginfo',
    rclimit: String(opts.limit ?? 20),
    rcdir: 'older',
    format: 'json',
    formatversion: '2',
  });
  if (opts.since) params.set('rcend', opts.since); // older direction: stop at `since`
  const res = await fetchT(fetchFn, `${apiBase}?${params}`, {
    headers: { 'User-Agent': UA },
    timeoutMs: opts.timeoutMs ?? 20_000,
  });
  const json = (await res.json()) as { query?: { recentchanges?: Array<{ pageid: number; title: string; timestamp: string; revid: number; type: string }> } };
  const changes = json.query?.recentchanges ?? [];
  return { changes, latest: changes[0]?.timestamp ?? null };
}
