/**
 * Browser-scrape strategies — cluster: russia-mena.
 *
 * Each connector visits exactly ONE public listing page per run, like a normal
 * user (the framework adds human dwell/scroll + pacing + challenge detection).
 * No pagination, no multi-page crawl. Extractors run in-page via page.$$eval and
 * derive a STABLE sourceId from the site's own id/slug in the href.
 *
 * Verified live (2026-06):
 *   - yandex-maps : /maps/<region>/search/<q>/ ; result anchors -> /maps/org/<name>/<id>/
 *                   (stable id = numeric org id). JS-heavy SPA -> long wait.
 *   - yandex-eda  : eda.yandex.ru/<city> ; restaurant anchors -> /restaurant/<slug>.
 *                   HARD Yandex SmartCaptcha even for a clean fetch -> needs BROWSER_PROXY.
 *   - talabat     : talabat.com/<country>/restaurants ; vendor-card anchors -> /<country>/<slug>.
 *                   Cloudflare-managed -> needs BROWSER_PROXY from a datacenter IP.
 *   - sygic-travel: travel.sygic.com now 301s to tripomatic.com. City list page
 *                   /en/list/what-to-see-in-<city>-city:<id> ; place anchors ->
 *                   /en/poi/<slug>-poi:<id> (stable id = poi:<id>), name in <h3> text.
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

export const browserRussiaMena: BrowserStrategy[] = [
  {
    id: 'yandex-maps',
    displayName: 'Yandex Maps (web scrape)',
    tier: 'E',
    coverage: 'Russia/CIS + global; businesses, ratings, reviews (ru/en)',
    access:
      'Public yandex.com/maps search results (alternative to the key-gated, display-only Geosearch API).',
    // Region code 213 = Moscow; input.region overrides the query text. ONE search page.
    listUrl: (input) =>
      `https://yandex.com/maps/213/moscow/search/${encodeURIComponent(input.region ?? 'рестораны')}/`,
    waitFor: 'a[href*="/maps/org/"]',
    incremental: {
      method: 'full-only',
      supported: true,
      description:
        'Geosearch/web expose no since/updated_after; one search page per run, diff the org set by content_hash.',
    },
    note:
      'SPA — results render late; if 0 items, increase the wait. Display-only ToS aside, this is purely technical: heavy JS, occasional Yandex SmartCaptcha may need BROWSER_PROXY (residential) from a datacenter IP.',
    // Business name is the anchor text; stable id is the numeric org id in /maps/org/<name>/<id>/.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/maps/org/"]',
        (els, max) => {
          const seen = new Set<string>();
          const out: Array<{ sourceId: string; name: string; url: string; raw: unknown }> = [];
          for (const e of els) {
            const a = e as HTMLAnchorElement;
            const id = a.href.match(/\/maps\/org\/[^/]+\/(\d+)/)?.[1];
            if (!id || seen.has(id)) continue;
            seen.add(id);
            out.push({
              sourceId: id,
              name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              url: a.href,
              raw: { href: a.href, orgId: id },
            });
            if (out.length >= (max as number)) break;
          }
          return out;
        },
        limit,
      ),
  },
  {
    id: 'yandex-eda',
    displayName: 'Yandex Eda (web scrape)',
    tier: 'E',
    coverage: 'Russia; food-delivery restaurants/menus (ru)',
    access:
      'Public eda.yandex.ru city catalog (no public content API; internal mobile/web endpoints only).',
    // ONE city catalog page; input.region selects the city slug (default moscow).
    listUrl: (input) => `https://eda.yandex.ru/${encodeURIComponent(input.region ?? 'moscow')}`,
    waitFor: 'a[href*="/restaurant/"]',
    incremental: {
      method: 'full-only',
      supported: true,
      description:
        'No public API and no usable public timestamp; one catalog page per run, diff the restaurant set by content_hash.',
    },
    note:
      'Yandex SmartCaptcha wall — a clean datacenter request already gets the captcha screen. Needs BROWSER_PROXY (residential) and likely BROWSER_HEADFUL=1; region-locked to RU.',
    // Restaurant name is the card/anchor text; stable id is the slug in /restaurant/<slug>.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/restaurant/"]',
        (els, max) => {
          const seen = new Set<string>();
          const out: Array<{ sourceId: string; name: string; url: string; raw: unknown }> = [];
          for (const e of els) {
            const a = e as HTMLAnchorElement;
            const slug = a.href.match(/\/restaurant\/([^/?#]+)/)?.[1];
            if (!slug || seen.has(slug)) continue;
            seen.add(slug);
            out.push({
              sourceId: slug.slice(0, 80),
              name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              url: a.href,
              raw: { href: a.href, slug },
            });
            if (out.length >= (max as number)) break;
          }
          return out;
        },
        limit,
      ),
  },
  {
    id: 'talabat',
    displayName: 'Talabat (web scrape)',
    tier: 'E',
    coverage: 'MENA (UAE/KSA/Kuwait/Qatar/...); delivery restaurants (en/ar)',
    access:
      'Public talabat.com/<country>/restaurants listing (no public content API; Delivery Hero internal only).',
    // ONE country restaurants page; input.region selects the country slug (default uae).
    listUrl: (input) =>
      `https://www.talabat.com/${encodeURIComponent(input.region ?? 'uae')}/restaurants`,
    waitFor: 'a[href*="/restaurant"]',
    incremental: {
      method: 'sitemap-lastmod',
      supported: true,
      description:
        'Sitemap index → per-URL <lastmod> is the cheapest change signal; the scrape itself reads ONE listing page and diffs by content_hash.',
    },
    note:
      'Cloudflare-managed protection — plain Chrome from a datacenter IP gets a managed challenge. Needs BROWSER_PROXY (residential/unblocker). UI/class names change often; the href shape /<country>/<slug> is the stable anchor.',
    // Restaurant name is the vendor-card link text; stable id is the slug in /<country>/<slug>.
    extract: (page, limit) =>
      page.$$eval(
        'a[data-testid*="vendor"], a[href*="/restaurant"]',
        (els, max) => {
          const seen = new Set<string>();
          const out: Array<{ sourceId: string; name: string; url: string; raw: unknown }> = [];
          for (const e of els) {
            const a = e as HTMLAnchorElement;
            const path = a.href.replace(/^https?:\/\/[^/]+/, '');
            // /<country>/<slug>  (skip nav/category links that lack a vendor slug)
            const m = path.match(/^\/[a-z]{2,}\/(?:restaurant\/)?([a-z0-9-]+)(?:\/|$|\?)/i);
            const slug = m?.[1];
            if (!slug || slug === 'restaurants' || seen.has(slug)) continue;
            seen.add(slug);
            out.push({
              sourceId: slug.slice(0, 80),
              name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              url: a.href,
              raw: { href: a.href, slug },
            });
            if (out.length >= (max as number)) break;
          }
          return out;
        },
        limit,
      ),
  },
  {
    id: 'sygic-travel',
    displayName: 'Sygic Travel / Tripomatic (web scrape)',
    tier: 'E',
    coverage: 'Global; trip-planner POIs + descriptions (multi-lang, en default)',
    access:
      'Public city POI list (alternative to the x-api-key-gated Sygic Places API). travel.sygic.com now 301s to tripomatic.com — we hit the final host directly.',
    // ONE city "what to see" list page. input.region = "<slug>-city:<id>" (e.g. paris-city:14); default Paris.
    listUrl: (input) =>
      `https://tripomatic.com/en/list/what-to-see-in-${encodeURIComponent(input.region ?? 'paris-city:14')}`,
    waitFor: 'a[href*="-poi:"]',
    incremental: {
      method: 'full-only',
      supported: true,
      description:
        'List has no recency order; one city list page per run, diff the POI set by content_hash.',
    },
    note:
      'Host moved travel.sygic.com -> tripomatic.com (301). If the framework reports a cross-host redirect, the listUrl already targets tripomatic.com so it should resolve on the first hop.',
    // POI name is the anchor/heading text; stable id is the numeric id in <slug>-poi:<id>.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="-poi:"]',
        (els, max) => {
          const seen = new Set<string>();
          const out: Array<{ sourceId: string; name: string; url: string; raw: unknown }> = [];
          for (const e of els) {
            const a = e as HTMLAnchorElement;
            const id = a.href.match(/-poi:(\d+)/)?.[1];
            if (!id || seen.has(id)) continue;
            seen.add(id);
            const name = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
            out.push({
              sourceId: `poi:${id}`,
              name,
              url: a.href,
              raw: { href: a.href, poiId: id },
            });
            if (out.length >= (max as number)) break;
          }
          return out;
        },
        limit,
      ),
  },
];
