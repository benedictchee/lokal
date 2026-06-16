import type { IncrementalCapability, PullInput, Tier } from './types.js';

/** A single scraped item (Playwright-free; identical to the old core/browser-connector shape). */
export interface ScrapedItem {
  sourceId: string;
  name?: string;
  lat?: number;
  lng?: number;
  url?: string;
  updated_at?: string;
  raw?: unknown;
}

/**
 * A browser-scrape strategy. `extract` runs over a STATIC parsed document (not a
 * live Playwright Page) so it is shared by the CLI (parse page.content()) and the
 * Worker (parse device DOM). Pure + synchronous → unit-testable on an HTML string.
 */
export interface BrowserStrategy {
  id: string;
  displayName: string;
  tier: Tier;
  coverage: string;
  access: string;
  listUrl: (input: PullInput) => string;
  waitFor?: string;
  consentSelectors?: string[];
  incremental: IncrementalCapability;
  extract: (doc: Document, baseUrl: string, limit: number) => ScrapedItem[];
  proxyEnv?: string;
  note?: string;
}

/** Generic anchor extractor: matching <a> → {sourceId,name,url} with absolute urls. */
export function anchors(
  doc: Document,
  baseUrl: string,
  selector: string,
  idFrom: (href: string) => string,
  limit: number,
): ScrapedItem[] {
  return [...doc.querySelectorAll(selector)]
    .slice(0, limit)
    .map((el) => {
      const raw = el.getAttribute('href') ?? '';
      const href = raw ? new URL(raw, baseUrl).toString() : '';
      const name = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      return { sourceId: href ? idFrom(href) : '', name, url: href, raw: { href, name } };
    })
    .filter((x) => x.sourceId && x.name);
}
