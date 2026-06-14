/**
 * OTA cluster — browser-scrape strategies (one page, one visit, human-like).
 *
 * These are the consumer-facing OTA / reservation / experiences sites. Each
 * connector visits exactly ONE public search/listing page per run and extracts
 * the result cards with page.$$eval. No pagination, no multi-page crawling.
 *
 * Verified live (plain Chrome, 2026-06) — render fine, scrape works:
 *   - viator        a[href*="/tours/"]            (200; id = productCode after -d<dest>-)
 *   - hostelworld   a.property-card-container     (200; id = /hostels/p/<digits>/)
 *   - trip-com      a.hotelName                   (200; id = hotelId=<digits>)
 *   - chope         a[href*="/restaurant/"]       (200; id = /restaurant/<slug>)
 *   - agoda         [data-selenium="hotel-item"]  (200; id = data-hotelid; SPA, lazy)
 *   - resy          a[href*="/venues/"]           (200; id = /venues/<slug>; SPA hydration)
 *   - michelin      h3 a[href*="/restaurant/"]    (202 interstitial but renders; CF-managed)
 *
 * Bot-walled from a datacenter IP (verified 403 / CF "Just a moment" / interstitial)
 * — STILL authored; the framework detects the challenge at runtime and the note
 * flags that BROWSER_PROXY (residential / unblocker) is required:
 *   - booking-com   202 interstitial   (documented data-testid selectors)
 *   - getyourguide  403 Cloudflare "Just a moment…"
 *   - klook         403
 *   - thefork       403 (DataDome family)
 *   - opentable     403 Access Denied
 *   - traveloka     403
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

const full = (desc: string) => ({ method: 'full-only' as const, supported: true, description: desc });
const sortNew = (desc: string) => ({ method: 'sort-by-updated' as const, supported: true, description: desc });

export const browserOta: BrowserStrategy[] = [
  /* ── booking-com ─ hotels; 202 interstitial from datacenter IP, needs proxy ── */
  {
    id: 'booking-com',
    displayName: 'Booking.com (web scrape)',
    tier: 'D',
    coverage: 'Global; hotels/properties + review scores',
    access: 'Public booking.com/searchresults (alternative to the partner-gated Demand API, which forbids review egress).',
    listUrl: (input) =>
      `https://www.booking.com/searchresults.html?ss=${encodeURIComponent(input.region ?? 'Penang, Malaysia')}`,
    waitFor: '[data-testid="property-card"]',
    consentSelectors: ['#onetrust-accept-btn-handler', 'button[aria-label="Accept"]'],
    incremental: full('One search page per run; diff property set + review-score by content_hash. No web sort-by-updated.'),
    note: 'Booking serves a 202 interstitial / consent wall to datacenter IPs — if 0 items, needs BROWSER_PROXY (residential/unblocker). Class names are randomised; data-testid is the stable hook.',
    // Property name lives in [data-testid="title"] inside the card; the card's title-link carries the /hotel/ slug.
    extract: (page, limit) =>
      page.$$eval('[data-testid="property-card"]', (cards, max) =>
        cards.slice(0, max as number).map((card) => {
          const a = card.querySelector('a[data-testid="title-link"]') as HTMLAnchorElement | null;
          const href = a?.href ?? '';
          const title = card.querySelector('[data-testid="title"]');
          const slug = href.match(/\/hotel\/[a-z]{2}\/([^.?#/]+)/)?.[1] ?? href.slice(0, 80);
          return {
            sourceId: slug,
            name: (title?.textContent ?? a?.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: href,
            raw: { href, name: (title?.textContent ?? '').trim().replace(/\s+/g, ' ') },
          };
        }),
      limit),
  },

  /* ── agoda ─ hotels; SPA, lazy cards; id = data-hotelid ── */
  {
    id: 'agoda',
    displayName: 'Agoda (web scrape)',
    tier: 'D',
    coverage: 'Global, dense APAC; hotels + review scores',
    access: 'Public agoda.com search (alternative to the affiliate API, which exposes no review egress).',
    // Agoda search keys off a numeric city id; default = Penang (city 17196). region can override the free-text.
    listUrl: (input) =>
      `https://www.agoda.com/search?city=17196&textToSearch=${encodeURIComponent(input.region ?? 'Penang')}`,
    waitFor: '[data-selenium="hotel-item"]',
    consentSelectors: ['button[data-selenium="cookie-accept"]', '#onetrust-accept-btn-handler'],
    incremental: full('One SPA search page per run; cards lazy-load on scroll. Diff hotel set + score by content_hash.'),
    note: 'SPA — hotel cards hydrate/lazy-load on scroll; the framework scroll usually surfaces ~20. If sparse, needs BROWSER_PROXY.',
    // Stable id = data-hotelid on the item; name = [data-selenium="hotel-name"]; link = first <a> (/<slug>/hotel/<city-cc>.html).
    extract: (page, limit) =>
      page.$$eval('[data-selenium="hotel-item"]', (items, max) =>
        items.slice(0, max as number).map((item) => {
          const a = item.querySelector('a[href]') as HTMLAnchorElement | null;
          const nameEl = item.querySelector('[data-selenium="hotel-name"]');
          const id = item.getAttribute('data-hotelid') ?? a?.href ?? '';
          return {
            sourceId: String(id).slice(0, 80),
            name: (nameEl?.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a?.href ?? '',
            raw: { hotelId: item.getAttribute('data-hotelid'), href: a?.href ?? '' },
          };
        }),
      limit),
  },

  /* ── klook ─ activities; 403 from datacenter IP, needs proxy ── */
  {
    id: 'klook',
    displayName: 'Klook (web scrape)',
    tier: 'D',
    coverage: 'APAC; activities/experiences + ratings',
    access: 'Public klook.com/en-US/search (alternative to the partner OpenAPI, whose reviews are display-only).',
    listUrl: (input) => `https://www.klook.com/en-US/search/?query=${encodeURIComponent(input.region ?? 'Penang')}`,
    waitFor: 'a[href*="/activity/"]',
    incremental: full('One search page per run; diff activity set + rating count by content_hash.'),
    note: 'Returns HTTP 403 to datacenter IPs — needs BROWSER_PROXY (residential/unblocker). URL id = numeric activity id.',
    // /en-US/activity/<numericId>-<slug>/ — id is the leading digits.
    extract: (page, limit) =>
      page.$$eval('a[href*="/activity/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          return {
            sourceId: a.href.match(/\/activity\/(\d+)/)?.[1] ?? a.href.slice(0, 80),
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
  },

  /* ── getyourguide ─ tours/activities; CF "Just a moment", needs proxy ── */
  {
    id: 'getyourguide',
    displayName: 'GetYourGuide (web scrape)',
    tier: 'D',
    coverage: 'Global; tours/activities + ratings/reviews',
    access: 'Public getyourguide.com/s search (alternative to the tier-gated Partner API review access).',
    listUrl: (input) => `https://www.getyourguide.com/s/?q=${encodeURIComponent(input.region ?? 'Penang')}`,
    waitFor: 'a[href*="-t"]',
    consentSelectors: ['#onetrust-accept-btn-handler', 'button[data-test-id="cookie-consent-accept"]'],
    incremental: full('One search page per run; diff activity set + review count by content_hash.'),
    note: 'Cloudflare-managed challenge ("Just a moment…", HTTP 403) from datacenter IPs — needs BROWSER_PROXY (residential).',
    // Activity URLs end in -t<digits> (tour id); locations use -l<digits>. Prefer the tour id.
    extract: (page, limit) =>
      page.$$eval('a[href*="-t"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const tid = a.href.match(/-t(\d+)(?:[/?#]|$)/)?.[1];
            return { a, tid };
          })
          .filter((x) => !!x.tid)
          .slice(0, max as number)
          .map(({ a, tid }) => ({
            sourceId: tid as string,
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          })),
      limit),
  },

  /* ── viator ─ tours/activities; verified 200 (works with plain Chrome) ── */
  {
    id: 'viator',
    displayName: 'Viator (web scrape)',
    tier: 'D',
    coverage: 'Global; tours/activities + reviews',
    access: 'Public viator.com search (alternative to the Partner API, whose reviews must stay non-indexable).',
    listUrl: (input) => `https://www.viator.com/searchResults/all?text=${encodeURIComponent(input.region ?? 'Penang')}`,
    waitFor: 'a[href*="/tours/"]',
    consentSelectors: ['#onetrust-accept-btn-handler'],
    incremental: full('One search page per run; diff product set + review count by content_hash.'),
    // /tours/<area>/<slug>/d<destId>-<productCode> — stable id = productCode after -d<digits>-.
    extract: (page, limit) =>
      page.$$eval('a[href*="/tours/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          const code = a.href.match(/\/d\d+-([A-Za-z0-9]+)(?:[/?#]|$)/)?.[1];
          const slug = a.href.match(/\/tours\/[^/]+\/([^/]+)\//)?.[1];
          return {
            sourceId: (code ?? slug ?? a.href).slice(0, 80),
            name: (slug ?? '').replace(/-/g, ' ').trim() || (a.getAttribute('title') ?? '').trim(),
            url: a.href,
            raw: { href: a.href, productCode: code ?? null },
          };
        }),
      limit),
    note: 'Result-card anchor text concatenates badges/duration, so name is derived from the URL slug (clean); productCode is the stable id.',
  },

  /* ── thefork ─ restaurants/reservations; 403 (DataDome family), needs proxy ── */
  {
    id: 'thefork',
    displayName: 'TheFork (web scrape)',
    tier: 'D',
    coverage: 'Europe; restaurants/reservations + reviews',
    access: 'Public thefork.com search (alternative to the Partners API, licensed to partnership sites only).',
    // cityId is TheFork's internal numeric id; default 415144 (Paris). region overrides the free-text query.
    listUrl: (input) =>
      input.region
        ? `https://www.thefork.com/search?q=${encodeURIComponent(input.region)}`
        : 'https://www.thefork.com/search?cityId=415144',
    waitFor: 'a[href*="/restaurant/"]',
    consentSelectors: ['#didomi-notice-agree-button', 'button[aria-label="Accept"]'],
    incremental: full('One search page per run; diff restaurant set + review count by content_hash.'),
    note: 'DataDome-family wall (HTTP 403) from datacenter IPs — needs BROWSER_PROXY (residential/unblocker).',
    // /restaurant/<slug>-r<id> — prefer the -r<id>; fall back to slug.
    extract: (page, limit) =>
      page.$$eval('a[href*="/restaurant/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          const rid = a.href.match(/-r(\d+)(?:[/?#]|$)/)?.[1];
          const slug = a.href.match(/\/restaurant\/([^/?#]+)/)?.[1];
          return {
            sourceId: (rid ?? slug ?? a.href).slice(0, 80),
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
  },

  /* ── opentable ─ restaurants/reservations; 403 Access Denied, needs proxy ── */
  {
    id: 'opentable',
    displayName: 'OpenTable (web scrape)',
    tier: 'D',
    coverage: 'Global (US-dense); restaurants/reservations + reviews',
    access: 'Public opentable.com/s search (alternative to the approval-gated Directory/Reviews API).',
    listUrl: (input) => `https://www.opentable.com/s?term=${encodeURIComponent(input.region ?? 'Singapore')}&covers=2`,
    waitFor: 'a[href*="/r/"]',
    consentSelectors: ['#onetrust-accept-btn-handler'],
    incremental: full('One search page per run; diff restaurant set + review count by content_hash.'),
    note: 'Returns HTTP 403 "Access Denied" to datacenter IPs — needs BROWSER_PROXY (residential/unblocker).',
    // Restaurant profile links are /r/<slug>; id = the slug.
    extract: (page, limit) =>
      page.$$eval('a[href*="/r/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          return {
            sourceId: (a.href.match(/\/r\/([^/?#]+)/)?.[1] ?? a.href).slice(0, 80),
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
  },

  /* ── resy ─ restaurants/reservations; verified 200 (SPA hydration) ── */
  {
    id: 'resy',
    displayName: 'Resy (web scrape)',
    tier: 'D',
    coverage: 'US + select global cities; restaurants/reservations',
    access: 'Public resy.com/cities city pages (alternative to the partnership-only API).',
    // resy.com/cities/<city>; default Singapore. region maps to the city slug.
    listUrl: (input) => `https://resy.com/cities/${encodeURIComponent((input.region ?? 'singapore-sg').toLowerCase().replace(/\s+/g, '-'))}`,
    waitFor: 'a[href*="/venues/"]',
    incremental: full('One SPA city page per run; venue cards hydrate client-side. Diff venue set by content_hash.'),
    note: 'SPA — venue anchors are built client-side; the framework dwell lets them hydrate to real /venues/<slug> hrefs (early reads can show /venues/?). If sparse, increase wait.',
    // /cities/<city>/venues/<slug>?... — stable id = the venue slug. Skip un-hydrated ?-only hrefs.
    extract: (page, limit) =>
      page.$$eval('a[href*="/venues/"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const slug = a.href.match(/\/venues\/([a-z0-9][a-z0-9-]+)/)?.[1];
            return { a, slug };
          })
          .filter((x) => !!x.slug && x.slug !== 'undefined')
          .slice(0, max as number)
          .map(({ a, slug }) => ({
            sourceId: slug as string,
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' ').replace(/\d.*$/, '').trim(),
            url: a.href,
            raw: { href: a.href },
          })),
      limit),
  },

  /* ── hostelworld ─ hostels; verified 200 (works with plain Chrome) ── */
  {
    id: 'hostelworld',
    displayName: 'Hostelworld (web scrape)',
    tier: 'D',
    coverage: 'Global; hostels + reviews/ratings',
    access: 'Public hostelworld.com/hostels listing pages (alternative to the partner API).',
    // hostelworld.com/hostels/<Place>; default Penang. region maps to the place segment.
    listUrl: (input) => `https://www.hostelworld.com/hostels/${encodeURIComponent((input.region ?? 'Penang').replace(/\s+/g, '-'))}`,
    waitFor: 'a[href*="/hostels/p/"]',
    consentSelectors: ['#onetrust-accept-btn-handler', 'button[aria-label="Accept"]'],
    incremental: sortNew('Listing is sortable by recency/rating; one page per run, diff property set + review count by content_hash.'),
    // a.property-card-container; id = /hostels/p/<digits>/; name = [class*="property-name"] inside the card.
    extract: (page, limit) =>
      page.$$eval('a.property-card-container[href*="/hostels/p/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          const nameEl = a.querySelector('[class*="property-name"]');
          return {
            sourceId: a.href.match(/\/hostels\/p\/(\d+)/)?.[1] ?? a.href.slice(0, 80),
            name: (nameEl?.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
    note: 'If 0 items, the card class changed — fall back to a[href*="/hostels/p/"] and the property-name node.',
  },

  /* ── trip-com ─ hotels; verified 200 (works with plain Chrome) ── */
  {
    id: 'trip-com',
    displayName: 'Trip.com (web scrape)',
    tier: 'D',
    coverage: 'Global; hotels + review scores',
    access: 'Public trip.com/hotels/list search (alternative to the connectivity API, which has no review egress).',
    listUrl: (input) =>
      `https://www.trip.com/hotels/list?searchWord=${encodeURIComponent(input.region ?? 'Penang')}`,
    waitFor: 'a[href*="/hotels/detail"]',
    consentSelectors: ['#onetrust-accept-btn-handler', '.cookie-policy-confirm'],
    incremental: full('One search page per run; diff hotel set + review score by content_hash.'),
    // a.hotelName links to /hotels/detail/?...hotelId=<digits>... — stable id = hotelId.
    extract: (page, limit) =>
      page.$$eval('a.hotelName[href*="/hotels/detail"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          return {
            sourceId: a.href.match(/[?&]hotelId=(\d+)/)?.[1] ?? a.href.slice(0, 80),
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
    note: 'If 0 items, the anchor class changed — fall back to a[href*="hotelId="] and read the nearest hotel-name node.',
  },

  /* ── traveloka ─ hotels; 403 from datacenter IP, needs proxy ── */
  {
    id: 'traveloka',
    displayName: 'Traveloka (web scrape)',
    tier: 'D',
    coverage: 'SEA; hotels/activities + reviews',
    access: 'Public traveloka.com hotel search (alternative to the B2B TPN/Atlas inventory, which has no review feed).',
    listUrl: (input) =>
      `https://www.traveloka.com/en-en/hotel/search?spec=&q=${encodeURIComponent(input.region ?? 'Penang')}`,
    waitFor: 'a[href*="/hotel/"]',
    consentSelectors: ['[data-testid="cookie-accept"]', '#onetrust-accept-btn-handler'],
    incremental: full('One search page per run; diff hotel set + review score by content_hash.'),
    note: 'Returns HTTP 403 to datacenter IPs — needs BROWSER_PROXY (residential/unblocker). Hotel detail links carry a numeric hotel id.',
    // Hotel detail links are /en-en/hotel/<slug>-<digits> — prefer the trailing numeric id.
    extract: (page, limit) =>
      page.$$eval('a[href*="/hotel/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          const id = a.href.match(/\/hotel\/[^?#]*?-(\d{6,})(?:[/?#]|$)/)?.[1];
          const slug = a.href.match(/\/hotel\/([^/?#]+)/)?.[1];
          return {
            sourceId: (id ?? slug ?? a.href).slice(0, 80),
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
  },

  /* ── chope ─ restaurants/reservations; verified 200 (works with plain Chrome) ── */
  {
    id: 'chope',
    displayName: 'Chope (web scrape)',
    tier: 'D',
    coverage: 'SG/HK/TH/ID/MY; restaurants/reservations',
    access: 'Public chope.co restaurant directory (alternative to the partner booking API, which has no review egress).',
    // chope.co/<city>-restaurants/list_of_restaurants; default Singapore. region maps to the city prefix.
    listUrl: (input) =>
      `https://www.chope.co/${encodeURIComponent((input.region ?? 'singapore').toLowerCase().replace(/\s+/g, '-'))}-restaurants/list_of_restaurants`,
    waitFor: 'a[href*="/restaurant/"]',
    consentSelectors: ['#onetrust-accept-btn-handler', '.cookie-accept'],
    incremental: full('One directory page per run; diff restaurant set by content_hash.'),
    // /<city>-restaurants/restaurant/<slug> — id = slug. Exclude /category/ index links.
    extract: (page, limit) =>
      page.$$eval('a[href*="/restaurant/"]', (els, max) =>
        els
          .map((e) => {
            const a = e as HTMLAnchorElement;
            const slug = a.href.includes('/category/') ? null : a.href.match(/\/restaurant\/([^/?#]+)(?:[/?#]|$)/)?.[1];
            return { a, slug };
          })
          .filter((x) => !!x.slug)
          .slice(0, max as number)
          .map(({ a, slug }) => ({
            sourceId: slug as string,
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          })),
      limit),
  },

  /* ── michelin-guide ─ restaurants; 202 interstitial but renders; CF-managed ── */
  {
    id: 'michelin-guide',
    displayName: 'Michelin Guide (web scrape)',
    tier: 'D',
    coverage: 'Global selections; starred/Bib Gourmand restaurants',
    access: 'Public guide.michelin.com/en/restaurants listing (no public API; content otherwise via licensed partners).',
    listUrl: (input) =>
      input.region
        ? `https://guide.michelin.com/en/restaurants/${encodeURIComponent(input.region.toLowerCase().replace(/\s+/g, '-'))}`
        : 'https://guide.michelin.com/en/restaurants',
    waitFor: 'h3 a[href*="/restaurant/"]',
    consentSelectors: ['#onetrust-accept-btn-handler', 'button[aria-label="Accept"]'],
    incremental: sortNew('Coarse delta = annual selection release; one listing page per run, diff restaurant set by content_hash.'),
    note: 'Serves a 202 interstitial (Cloudflare-managed) from datacenter IPs but usually renders cards — if 0 items, needs BROWSER_PROXY (residential).',
    // Card title is the h3 > a; href ends in /restaurant/<slug>; name = clean anchor text.
    extract: (page, limit) =>
      page.$$eval('h3 a[href*="/restaurant/"]', (els, max) =>
        els.slice(0, max as number).map((e) => {
          const a = e as HTMLAnchorElement;
          return {
            sourceId: (a.href.match(/\/restaurant\/([^/?#]+)(?:[/?#]|$)/)?.[1] ?? a.href).slice(0, 80),
            name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
            url: a.href,
            raw: { href: a.href },
          };
        }),
      limit),
  },
];
