import type { IncrementalCapability, PullInput, Tier } from './types.js';
import type { ParsedDocument } from './parse-html.js';

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
  extract: (doc: ParsedDocument, baseUrl: string, limit: number) => ScrapedItem[];
  proxyEnv?: string;
  note?: string;
}

/**
 * Minimal element shape the extractor touches — kept local so we never depend on
 * the global lib.dom `Element` (linkedom's querySelectorAll is loosely typed).
 */
interface ExtractEl {
  getAttribute(name: string): string | null;
  textContent: string | null;
}

/** Generic anchor extractor: matching <a> → {sourceId,name,url} with absolute urls. */
export function anchors(
  doc: ParsedDocument,
  baseUrl: string,
  selector: string,
  idFrom: (href: string) => string,
  limit: number,
): ScrapedItem[] {
  return Array.from(doc.querySelectorAll(selector) as Iterable<ExtractEl>)
    .map((el) => {
      const raw = el.getAttribute('href') ?? '';
      let href = '';
      if (raw) {
        try {
          href = new URL(raw, baseUrl).toString();
        } catch {
          href = '';
        }
      }
      const name = (el.textContent ?? '').trim().replace(/\s+/g, ' ');
      return { sourceId: href ? idFrom(href) : '', name, url: href, raw: { href, name } };
    })
    .filter((x) => x.sourceId && x.name)
    .slice(0, limit);
}
