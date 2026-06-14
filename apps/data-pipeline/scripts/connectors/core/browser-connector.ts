/**
 * defineBrowserConnector — turns a per-source BrowserStrategy into a SourceConnector
 * that scrapes the public website like a normal user: ONE page, ONE visit per run,
 * human-like dwell/scroll, no pagination. Used for sources behind a key/licence or
 * with no API at all (the user holds scraping agreements for these).
 *
 * Fingerprint respects "1 page 1 time": it is derived ONLY from the single page we
 * loaded (hash of the extracted item ids + title) — we do not make extra requests
 * (e.g. a separate sitemap fetch) just to fingerprint.
 *
 * Hard WAFs (DataDome/Cloudflare-managed) return a challenge from a datacenter IP;
 * the connector reports `blocked` with the precise wall and the escalation path:
 * set BROWSER_PROXY to a residential proxy / unblocker endpoint.
 */
import { defineConnector } from './connector.js';
import { fnv1a, mkRecord, sourceFp } from './fingerprint.js';
import { browserEnabled, scrapePage } from './browser.js';
import type { IncrementalCapability, PullInput, SourceConnector, Tier } from './types.js';
import type { Page } from 'playwright';

export interface ScrapedItem {
  sourceId: string;
  name?: string;
  lat?: number;
  lng?: number;
  url?: string;
  updated_at?: string;
  raw?: unknown;
}

export interface BrowserStrategy {
  id: string;
  displayName: string;
  tier: Tier;
  coverage: string;
  /** Why we scrape (no API / key-gated / licence-gated) — shown in plan.access. */
  access: string;
  /** Build the SINGLE listing/detail URL to visit. Keep it to one meaningful page. */
  listUrl: (input: PullInput) => string;
  /** CSS to wait for before extracting (optional). */
  waitFor?: string;
  consentSelectors?: string[];
  incremental: IncrementalCapability;
  /** Page-side extractor — returns the items found on the one page. */
  extract: (page: Page, limit: number) => Promise<ScrapedItem[]>;
  /** Env var holding a residential proxy / unblocker (default BROWSER_PROXY). */
  proxyEnv?: string;
  note?: string;
}

export function defineBrowserConnector(s: BrowserStrategy): SourceConnector {
  return defineConnector({
    id: s.id,
    displayName: s.displayName,
    tier: s.tier,
    coverage: s.coverage,
    plan: {
      access: s.access,
      incremental: s.incremental.description,
      fingerprint: 'hash of the single page\'s extracted item ids + title (no extra requests)',
    },
    async run(input: PullInput, deps) {
      if (!browserEnabled(deps.env)) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { reason: 'browser disabled' }),
          incremental: { ...s.incremental, supported: false },
          notes: ['Browser scraping disabled — run with PROBE_BROWSER=1 (and `--browser`) to scrape this source.'],
        };
      }
      const limit = Math.min(input.limit ?? 10, 25);
      const url = s.listUrl(input);
      const proxy = deps.env[s.proxyEnv ?? 'BROWSER_PROXY'];
      const outcome = await scrapePage(url, (page) => s.extract(page, limit), {
        timeoutMs: deps.timeoutMs - 4000,
        waitFor: s.waitFor,
        consentSelectors: s.consentSelectors,
        proxy,
        headless: deps.env.BROWSER_HEADFUL === '1' ? false : true,
      });

      if (outcome.challenge) {
        return {
          status: 'blocked',
          sourceFingerprint: sourceFp('none', { challenge: outcome.challenge, url }),
          incremental: { ...s.incremental, supported: false },
          notes: [
            `Bot wall: ${outcome.challenge} (HTTP ${outcome.status}). Plain Chrome from a datacenter IP is blocked.`,
            'Escalation: set BROWSER_PROXY to a residential proxy / unblocker endpoint (and optionally BROWSER_HEADFUL=1).',
            ...(s.note ? [s.note] : []),
          ],
        };
      }

      const items = outcome.items.slice(0, limit);
      const records = items.map((it) =>
        mkRecord(s.id, it.sourceId, it.raw ?? it, {
          name: it.name,
          lat: it.lat,
          lng: it.lng,
          updated_at: it.updated_at,
          raw: it.raw ?? { name: it.name, url: it.url },
        }),
      );
      const idsHash = fnv1a(items.map((i) => i.sourceId).sort().join('|'));
      return {
        status: records.length ? 'ok' : 'partial',
        sourceFingerprint: sourceFp('page-items-hash', { count: records.length, idsHash, title: outcome.title.slice(0, 60) }),
        incremental: { ...s.incremental, sinceApplied: input.sinceTimestamp },
        records,
        notes: [
          `Scraped ONE page (${url}) like a user: ${records.length} items, body ${outcome.bodyLen} chars.`,
          ...(records.length === 0 ? ['0 items — selector likely needs tuning (drill down separately).'] : []),
          ...(s.note ? [s.note] : []),
        ],
      };
    },
  });
}
