/**
 * Browser-scrape strategies — cluster: global-community.
 *
 * Scrape the public website like a normal user: ONE page, ONE visit per run,
 * human-like dwell/scroll, no pagination. The framework (defineBrowserConnector +
 * scrapePage) adds dwell/scroll/pacing and detects bot walls at runtime; when a
 * source is DataDome / Cloudflare-managed, plain Chrome from a datacenter IP is
 * challenged and the connector reports `blocked` with the BROWSER_PROXY escalation.
 *
 * Each `extract` runs in the browser via page.$$eval, maps result anchors to items,
 * and slices to `limit`. sourceId is the site's OWN stable id/slug pulled from the
 * href (e.g. HappyCow trailing -<id>, JNTO /spot/<id>/, Airbnb /rooms/<id>,
 * Tripadvisor ShowTopic -k<topicId>, AllTrails /trail/.../<slug>).
 *
 * Verified live (June 2026):
 *   - happycow:           /reviews/<slug>-<id> anchors render in plain HTML (200 OK).
 *   - culture-trip:       /<region>/<country>/articles/<slug> article anchors.
 *   - jnto-content:       /spot/<id>/ + /destinations/<region>/<pref>/ anchors (200 OK).
 *   - airbnb:             /rooms/<id> cards behind heavy anti-bot (WAF note).
 *   - tripadvisor-forums: ShowForum-g<geo>-i<id> index lists ShowTopic links (DataDome).
 *   - alltrails:          /trail/<country>/<state>/<slug> — returns HTTP 403 to plain
 *                         Chrome (DataDome), needs BROWSER_PROXY.
 * (foursquare-consumer is intentionally absent — its consumer City Guide website was
 *  sunset 2025-04-28 and app.foursquare.com is login-gated; see the skipped list.)
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

const full = (desc: string) => ({ method: 'full-only' as const, supported: true, description: desc });

export const browserGlobalCommunity: BrowserStrategy[] = [
  {
    id: 'happycow',
    displayName: 'HappyCow (web scrape)',
    tier: 'E',
    coverage: 'Global; vegan/vegetarian restaurants, cafes & health stores + reviews',
    access: 'Public happycow.net region listing pages (no public consumer data API).',
    listUrl: (input) =>
      `https://www.happycow.net/${input.region ?? 'asia/malaysia/penang'}/`,
    waitFor: 'a[href*="/reviews/"]',
    incremental: full('One region listing page per run; diff the venue set by content_hash (no recency sort on the listing).'),
    note: 'Intermittently Cloudflare-managed: if challenged, needs BROWSER_PROXY (residential/unblocker).',
    // Venue anchors carry a trailing numeric id: /reviews/<slug>-<id>. Name lives in the title attr.
    extract: (page, limit) =>
      page.$$eval('a[href*="/reviews/"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const href = a.href;
            const id = href.match(/\/reviews\/(?:.*-)?(\d+)\/?$/)?.[1];
            const slug = href.match(/\/reviews\/([^/?#]+)/)?.[1];
            const name = (a.getAttribute('title') ?? a.textContent ?? '')
              .replace(/^Image of\s+/i, '')
              .trim()
              .replace(/\s+/g, ' ');
            return { sourceId: (id ?? slug ?? href).slice(0, 80), name, url: href, raw: { href, name } };
          })
          .filter((x) => x.url && x.sourceId)
          .slice(0, max as number),
      limit),
  },
  {
    id: 'culture-trip',
    displayName: 'Culture Trip (web scrape)',
    tier: 'E',
    coverage: 'Global; editorial place/food/travel guides (English)',
    access: 'Public theculturetrip.com article listing pages (no public content API).',
    listUrl: (input) =>
      `https://theculturetrip.com/${input.region ?? 'asia/malaysia'}/articles`,
    waitFor: 'a[href*="/articles/"]',
    incremental: full('One country/region article listing page per run; diff the article set by content_hash.'),
    // Article anchors: /<region>/<country>/articles/<slug>. Name is the link text.
    extract: (page, limit) =>
      page.$$eval('a[href*="/articles/"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const href = a.href;
            const slug = href.match(/\/articles\/([^/?#]+)/)?.[1];
            const name = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
            return { sourceId: (slug ?? href).slice(0, 80), name, url: href, raw: { href, name } };
          })
          .filter((x) => x.sourceId && x.name)
          .slice(0, max as number),
      limit),
  },
  {
    id: 'airbnb',
    displayName: 'Airbnb (web scrape)',
    tier: 'C',
    coverage: 'Global; stays/homes listings, ratings & review counts',
    access: 'Public airbnb.com/s/<place>/homes search results (alternative to the partner-gated API).',
    listUrl: (input) =>
      `https://www.airbnb.com/s/${encodeURIComponent(input.region ?? 'Penang--Malaysia')}/homes`,
    waitFor: 'a[href*="/rooms/"]',
    incremental: full('One search page per run; diff the listing set by content_hash (search has no public sort-by-new).'),
    note: 'Heavy anti-bot (Airbnb bot wall / PerimeterX-class): needs BROWSER_PROXY (residential/unblocker) from a datacenter IP.',
    // Listing anchors: /rooms/<id>. Name is exposed via aria-label on the card link (not link text).
    extract: (page, limit) =>
      page.$$eval('a[href*="/rooms/"]', (els, max) => {
        const seen = new Set<string>();
        const out: Array<{ sourceId: string; name: string; url: string; raw: unknown }> = [];
        for (const e of els) {
          const a = e as HTMLAnchorElement;
          const href = a.href;
          const id = href.match(/\/rooms\/(?:plus\/)?(\d+)/)?.[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const name = (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ');
          out.push({ sourceId: id, name, url: href.split('?')[0], raw: { href, name } });
          if (out.length >= (max as number)) break;
        }
        return out;
      }, limit),
  },
  {
    id: 'tripadvisor-forums',
    displayName: 'Tripadvisor Forums (web scrape)',
    tier: 'C',
    coverage: 'Global; destination Q&A forum threads (traveller-generated)',
    access: 'Public tripadvisor.com/ShowForum destination forum index (alternative to the cache-restricted Content API; forums are not in the API at all).',
    // ShowForum-g<geo>-i<forumId>-<slug>.html — default to Penang (g298303).
    listUrl: (input) =>
      input.region && /^ShowForum-/i.test(input.region)
        ? `https://www.tripadvisor.com/${input.region}`
        : 'https://www.tripadvisor.com/ShowForum-g298303-i9402-Penang_Penang_State.html',
    waitFor: 'a[href*="/ShowTopic"]',
    incremental: full('One forum index page per run; the index is already newest-first by last reply, so diff the thread set by content_hash.'),
    note: 'DataDome-protected (Tripadvisor family): needs BROWSER_PROXY (residential/unblocker).',
    // Thread anchors: ShowTopic-g<geo>-i<forumId>-k<topicId>-<slug>.html. Name is the link text.
    extract: (page, limit) =>
      page.$$eval('a[href*="/ShowTopic"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const href = a.href;
            const topicId = href.match(/-k(\d+)-/)?.[1];
            const name = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
            return { sourceId: (topicId ?? href).slice(0, 80), name, url: href, raw: { href, name } };
          })
          .filter((x) => x.sourceId && x.name)
          .slice(0, max as number),
      limit),
  },
  {
    id: 'jnto-content',
    displayName: 'JNTO Japan Travel (web scrape)',
    tier: 'E',
    coverage: 'Japan; official JNTO destinations & spot/attraction guides (English)',
    access: 'Public japan.travel/en destination listing pages (no public content API).',
    listUrl: (input) =>
      `https://www.japan.travel/en/destinations/${input.region ?? 'kansai/kyoto'}/`,
    waitFor: 'a[href*="/spot/"], a[href*="/destinations/"]',
    incremental: full('One destination/region page per run; diff the spot + sub-area set by content_hash.'),
    // Spot anchors: /en/spot/<id>/ (numeric id). Name is the link text.
    extract: (page, limit) =>
      page.$$eval('a[href*="/spot/"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const href = a.href;
            const id = href.match(/\/spot\/(\d+)/)?.[1];
            const name = (a.textContent ?? '').trim().replace(/\s+/g, ' ');
            return { sourceId: (id ?? href).slice(0, 80), name, url: href, raw: { href, name } };
          })
          .filter((x) => x.sourceId)
          .slice(0, max as number),
      limit),
  },
  {
    id: 'alltrails',
    displayName: 'AllTrails (web scrape)',
    tier: 'C',
    coverage: 'Global; hiking/biking/running trails, ratings & reviews',
    access: 'Public alltrails.com region pages (alternative to the partner-gated API).',
    // Region landing pages list trails as /trail/<country>/<state>/<slug>.
    listUrl: (input) => `https://www.alltrails.com/${input.region ?? 'us/california'}`,
    waitFor: 'a[href*="/trail/"]',
    incremental: full('One region page per run; diff the trail set by content_hash (no public sort-by-new on region pages).'),
    note: 'DataDome-protected: plain Chrome from a datacenter IP gets HTTP 403. Needs BROWSER_PROXY (residential/unblocker).',
    // Trail anchors: /trail/<country>/<state>/<slug>. sourceId = the full slug path. Name is link text or aria-label.
    extract: (page, limit) =>
      page.$$eval('a[href*="/trail/"]', (els, max) => {
        const seen = new Set<string>();
        const out: Array<{ sourceId: string; name: string; url: string; raw: unknown }> = [];
        for (const e of els) {
          const a = e as HTMLAnchorElement;
          const href = a.href;
          const slug = href.match(/\/trail\/([^?#]+)/)?.[1]?.replace(/\/$/, '');
          if (!slug || seen.has(slug)) continue;
          seen.add(slug);
          const name = (a.textContent ?? a.getAttribute('aria-label') ?? '').trim().replace(/\s+/g, ' ');
          out.push({ sourceId: slug.slice(0, 80), name, url: href.split('?')[0], raw: { href, name } });
          if (out.length >= (max as number)) break;
        }
        return out;
      }, limit),
  },
];
