/**
 * Fingerprint + record helpers shared by all connectors.
 *
 * Reuses the repo's `fnv1a` (pipeline-core) as the canonical content hash so a
 * connector's per-record `content_hash` matches what the real pipeline uses for
 * change detection. SHA-256 is available for cases needing a wider hash.
 */
import { createHash } from 'node:crypto';
import { fnv1a, recordUuid } from '@travel/pipeline-core';
import type { PulledRecord, SourceFingerprint } from './types.js';

export { fnv1a, recordUuid };

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/** Deterministic JSON stringify (sorted keys) so hashes are stable across runs. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(',')}}`;
}

/** Build a PulledRecord with stable id + content hash from canonical content. */
export function mkRecord(
  connectorId: string,
  sourceId: string,
  content: unknown,
  extra: Partial<Pick<PulledRecord, 'updated_at' | 'name' | 'lat' | 'lng' | 'raw' | 'source_url'>> = {},
): PulledRecord {
  return {
    source_id: sourceId,
    record_uuid: recordUuid(connectorId, sourceId),
    content_hash: fnv1a(typeof content === 'string' ? content : stableStringify(content)),
    ...extra,
  };
}

/**
 * Build a SourceFingerprint from named components. The value is the fnv1a of the
 * stable-serialized components, so equal components → equal fingerprint, and a
 * single field change flips it. `method` documents the strategy for humans.
 */
export function sourceFp(
  method: string,
  components: Record<string, string | number>,
): SourceFingerprint {
  return {
    method,
    value: fnv1a(stableStringify(components)),
    components,
    capturedAt: new Date().toISOString(),
  };
}

/** fetch with an AbortController timeout; throws on timeout/!ok by default. */
export async function fetchT(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number; allowNotOk?: boolean } = {},
): Promise<Response> {
  const { timeoutMs = 20_000, allowNotOk = false, ...rest } = init;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchFn(url, { ...rest, signal: ac.signal });
    if (!allowNotOk && !res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    }
    return res;
  } finally {
    clearTimeout(t);
  }
}

export const UA = 'travel-data-pipeline-prototype/0.1 (+management@rushowl.app)';

/**
 * Cheap source-state probe from HTTP headers: ETag / Last-Modified / Content-Length.
 * The universal fallback fingerprint when a source exposes no version/timestamp
 * in its payload — works on any URL via a HEAD (or ranged GET) request.
 */
export async function headFingerprint(
  fetchFn: typeof fetch,
  url: string,
  timeoutMs = 15_000,
): Promise<{ fp: SourceFingerprint | null; status: number; headers: Record<string, string> }> {
  let res: Response;
  try {
    res = await fetchT(fetchFn, url, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      timeoutMs,
      allowNotOk: true,
    });
  } catch {
    return { fp: null, status: 0, headers: {} };
  }
  const h: Record<string, string> = {};
  for (const k of ['etag', 'last-modified', 'content-length', 'content-type']) {
    const v = res.headers.get(k);
    if (v) h[k] = v;
  }
  const etag = h['etag'];
  const lastmod = h['last-modified'];
  const len = h['content-length'];
  if (!etag && !lastmod && !len) return { fp: null, status: res.status, headers: h };
  return {
    fp: sourceFp(etag ? 'etag' : lastmod ? 'last-modified' : 'content-length', {
      ...(etag ? { etag } : {}),
      ...(lastmod ? { lastModified: lastmod } : {}),
      ...(len ? { contentLength: len } : {}),
    }),
    status: res.status,
    headers: h,
  };
}

/**
 * Detect a bot-challenge / WAF / anti-bot interstitial so connectors report
 * "blocked (needs proxy)" instead of a misleading 0-items parse result.
 * Heuristic but high-signal; `urlAfter` (optional) catches login/captcha redirects.
 */
export function looksLikeChallenge(status: number, body: string, urlAfter?: string): string | null {
  const b = body.slice(0, 4000).toLowerCase();
  const u = (urlAfter ?? '').toLowerCase();
  // Vendor fingerprints (any status).
  if (b.includes('just a moment') || b.includes('cf-chl') || b.includes('challenges.cloudflare.com'))
    return 'Cloudflare challenge';
  if (b.includes('datadome')) return 'DataDome challenge';
  if (b.includes('px-captcha') || b.includes('perimeterx') || b.includes('_pxhd')) return 'PerimeterX/HUMAN challenge';
  if (b.includes('captcha.gtimg') || b.includes('turing.captcha') || b.includes('geetest') || b.includes('aliyun') && b.includes('captcha'))
    return 'CAPTCHA (anti-bot)';
  if (b.includes('are you not a robot') || b.includes('showcaptcha') || u.includes('showcaptcha')) return 'Yandex SmartCaptcha';
  // Generic WAF interstitials.
  if (b.includes('access denied') || b.includes('request could not be satisfied') || b.includes('pardon our interruption') || b.includes('attention required'))
    return 'WAF block (Access Denied)';
  // Redirected to a login or captcha gate instead of content.
  if (u.includes('/login') || u.includes('signin') || u.includes('/captcha') || u.includes('/win-together'))
    return 'redirected to login/gate';
  // Anti-bot HTTP statuses.
  if (status === 429) return 'rate-limited (429)';
  if (status === 432) return 'anti-bot (432)';
  if (status === 451) return 'unavailable for legal reasons (451)';
  if (status === 403) return 'forbidden (403)';
  if (status === 503) return 'unavailable (503)';
  return null;
}

/**
 * Probe a sitemap (or sitemap INDEX, following one level of nesting) for
 * <lastmod> values — a cheap, ToS-light change-detection heuristic for sources
 * with no API timestamp. Returns max lastmod + URL count (→ source fingerprint),
 * or a `challenge` marker if a WAF blocked it.
 */
export async function sitemapProbe(
  fetchFn: typeof fetch,
  sitemapUrl: string,
  timeoutMs = 15_000,
): Promise<{ urlCount: number; maxLastmod: string | null; sampleLoc: string | null; challenge?: string } | null> {
  let res: Response;
  try {
    res = await fetchT(fetchFn, sitemapUrl, { headers: { 'User-Agent': UA }, timeoutMs, allowNotOk: true });
  } catch {
    return null;
  }
  const xml = await res.text();
  const challenge = looksLikeChallenge(res.status, xml);
  if (challenge) return { urlCount: 0, maxLastmod: null, sampleLoc: null, challenge };
  if (!res.ok) return null;

  // Sitemap index → recurse into the first child sitemap once.
  if (/<sitemapindex/i.test(xml)) {
    const childLocs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
    const idxLastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!.trim());
    if (childLocs[0]) {
      const child = await sitemapProbe(fetchFn, childLocs[0], timeoutMs);
      if (child)
        return {
          urlCount: child.urlCount,
          maxLastmod: [child.maxLastmod, ...idxLastmods].filter(Boolean).sort().at(-1) ?? null,
          sampleLoc: child.sampleLoc,
          challenge: child.challenge,
        };
    }
    const maxLastmod = idxLastmods.length ? idxLastmods.sort().at(-1)! : null;
    return { urlCount: childLocs.length, maxLastmod, sampleLoc: childLocs[0] ?? null };
  }

  const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]!.trim());
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
  const maxLastmod = lastmods.length ? lastmods.sort().at(-1)! : null;
  return { urlCount: locs.length, maxLastmod, sampleLoc: locs[0] ?? null };
}
