/**
 * Browser-scrape strategies — scrape the public website (one page, one visit,
 * human-like) for sources that are key-gated, licence-gated, or have no API.
 *
 * This starter set spans the difficulty range and is verified live:
 *   - render-fine (works with plain Chrome): google-maps, tabelog, wongnai
 *   - SPA needing a wait:                     2gis
 *   - enterprise WAF (needs proxy/unblocker): yelp, tripadvisor, atlas-obscura
 *
 * More strategies are appended by the generator. Each connector visits exactly ONE
 * page per run; extractors must not paginate.
 */
import { type BrowserStrategy, anchors } from '../core/browser-strategy.js';

// Shared anchor extractor + incremental helpers, exported for generated modules to reuse.

const full = (desc: string) => ({ method: 'full-only' as const, supported: true, description: desc });
const sortNew = (desc: string) => ({ method: 'sort-by-updated' as const, supported: true, description: desc });

const STRATEGIES: BrowserStrategy[] = [
  {
    id: 'google-maps',
    displayName: 'Google Maps (web scrape)',
    tier: 'C',
    coverage: 'Global; reviews/ratings/POIs',
    access: 'Public maps.google.com search results (alternative to the key-gated Places API).',
    listUrl: (input) =>
      `https://www.google.com/maps/search/${encodeURIComponent(input.region ?? 'restaurants in George Town Penang')}`,
    waitFor: 'div[role="feed"] a[href*="/maps/place/"]',
    incremental: full('No web sort-by-new; one search page per run, diff results by content_hash. Use the Places API date fields if a key is available.'),
    // Google place anchors carry the name in aria-label (not text) — query the static DOM.
    extract: (doc, _baseUrl, limit) =>
      [...doc.querySelectorAll('div[role="feed"] a[href*="/maps/place/"], div[role="feed"] a[href*="!19s"]')]
        .slice(0, limit)
        .map((a) => {
          const href = a.getAttribute('href') ?? '';
          const m = href.match(/!19s(ChIJ[^!?&]+)/) || href.match(/\/place\/([^/]+)/);
          const name = a.getAttribute('aria-label') ?? '';
          return { sourceId: m ? decodeURIComponent(m[1]!) : href.slice(0, 80), name, url: href, raw: { href, name } };
        })
        .filter((x) => x.name),
  },
  {
    id: 'tabelog',
    displayName: 'Tabelog (web scrape)',
    tier: 'E',
    coverage: 'Japan; 食べログ score, reviews, photos',
    access: 'Public tabelog.com listing pages (no public data API).',
    listUrl: (input) => `https://tabelog.com/en/${input.region ?? 'kanagawa'}/`,
    waitFor: 'a.list-rst__rst-name-target',
    incremental: full('One area listing page per run; diff restaurant set by content_hash. Tabelog has no updated_since.'),
    extract: (doc, baseUrl, limit) =>
      anchors(doc, baseUrl, 'a.list-rst__rst-name-target', (href) => href.replace(/^https?:\/\/tabelog\.com/, '').replace(/\/$/, ''), limit),
  },
  {
    id: 'wongnai',
    displayName: 'Wongnai (web scrape)',
    tier: 'E',
    coverage: 'Thailand; reviews/ratings/menus',
    access: 'Public wongnai.com listing pages (only a merchant/POS API exists).',
    listUrl: () => 'https://www.wongnai.com/restaurants',
    waitFor: 'a[href*="/restaurants/"]',
    incremental: sortNew('Listing supports recency ordering; one page per run, stop at items older than since on later builds.'),
    extract: (doc, baseUrl, limit) =>
      anchors(doc, baseUrl, 'a[href*="/restaurants/"]', (href) => (href.match(/\/restaurants\/([^/?#]+)/)?.[1] ?? href).slice(0, 80), limit),
  },
  {
    id: '2gis',
    displayName: '2GIS (web scrape)',
    tier: 'E',
    coverage: 'Russia/CIS; business directory, reviews',
    access: 'Public 2gis.ru search (alternative to the key-gated Catalog API).',
    listUrl: (input) => `https://2gis.ru/moscow/search/${encodeURIComponent(input.region ?? 'кафе')}`,
    waitFor: 'a[href*="/firm/"]',
    incremental: full('One SPA search page per run; diff firm set by content_hash.'),
    note: 'SPA — if 0 items, the firm list renders late; increase wait or target the result container.',
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/firm/"]', (href) => href.match(/\/firm\/(\d+)/)?.[1] ?? href, limit),
  },
  {
    id: 'yelp',
    displayName: 'Yelp (web scrape)',
    tier: 'C',
    coverage: 'US-primary; reviews/ratings',
    access: 'Public yelp.com search (alternative to the 24h-cache Fusion API).',
    listUrl: (input) => `https://www.yelp.com/search?find_desc=restaurants&find_loc=${encodeURIComponent(input.region ?? 'San Francisco, CA')}`,
    waitFor: 'h3 a[href*="/biz/"]',
    incremental: full('One search page per run; diff by content_hash.'),
    note: 'DataDome-protected: needs BROWSER_PROXY (residential/unblocker) from a datacenter IP.',
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/biz/"]', (href) => href.match(/\/biz\/([^/?#]+)/)?.[1] ?? href, limit),
  },
  {
    id: 'tripadvisor',
    displayName: 'Tripadvisor (web scrape)',
    tier: 'C',
    coverage: 'Global; reviews/ratings/forums',
    access: 'Public tripadvisor.com lists (alternative to the cache-restricted Content API).',
    listUrl: () => 'https://www.tripadvisor.com/Restaurants-g298303-Penang.html',
    waitFor: 'a[href*="/Restaurant_Review"]',
    incremental: full('One list page per run; diff by content_hash.'),
    note: 'DataDome-protected: needs BROWSER_PROXY (residential/unblocker).',
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/Restaurant_Review"]', (href) => href.match(/-d(\d+)-/)?.[1] ?? href, limit),
  },
  {
    id: 'atlas-obscura-web',
    displayName: 'Atlas Obscura (web scrape)',
    tier: 'E',
    coverage: 'Global; offbeat POIs + editorial',
    access: 'Public atlasobscura.com/places (no API).',
    listUrl: () => 'https://www.atlasobscura.com/places',
    waitFor: 'a[href*="/places/"]',
    incremental: full('One listing page per run; diff by content_hash.'),
    note: 'Cloudflare-managed challenge: needs BROWSER_PROXY (residential) / headed solve.',
    extract: (doc, baseUrl, limit) => anchors(doc, baseUrl, 'a[href*="/places/"]', (href) => href.match(/\/places\/([a-z0-9-]+)$/)?.[1] ?? href, limit),
  },
];

export const starterStrategies: BrowserStrategy[] = STRATEGIES;
