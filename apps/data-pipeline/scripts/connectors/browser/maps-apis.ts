/**
 * Browser-scrape strategies — cluster: maps-apis.
 *
 * Map/listing sites that are key-gated, login-gated, or have no usable public
 * API. Each connector visits exactly ONE public listing/search page per run,
 * human-like (the framework adds dwell/scroll/pacing + challenge detection).
 * Extractors NEVER paginate; they map the result anchors on the single page to
 * items, sliced to `limit`, with a STABLE sourceId derived from the site's own
 * id/slug in the href.
 *
 * Note on typing: this scripts tsconfig does not load `lib.dom`, so each matched
 * element is cast (via `as unknown as {...}`) to a minimal structural shape with
 * just the members we touch (href/textContent/getAttribute/querySelector) inside
 * the page.$$eval callback, rather than to the DOM globals (HTMLAnchorElement, …)
 * which are not declared here. The cast is sound — Playwright runs the callback
 * in the real browser where these are genuine HTMLAnchorElement/HTMLElement.
 *
 * Live-verified (plain Chrome, datacenter IP) on 2026-06-14:
 *   - render-fine: hot-pepper-gourmet (a[href*="/strJ"]), jalan (/kankou/spt_guide),
 *     kakaomap (.placelist > li + place.map.kakao.com/<id>)
 *   - hard wall  : expedia-hotels-com (HTTP 429 "Bot or Not?" / PerimeterX),
 *     untappd (HTTP 403 Cloudflare "Just a moment…"),
 *     naver-map (Naver returns "서비스 이용이 제한되었습니다" with the datacenter IP),
 *     amap / baidu-maps (SPA + signed-XHR/canvas render, China-IP gated)
 *   - SPA aria   : google-hotels (Google Travel, name in aria-label)
 *   - login wall : foursquare (foursquare.com/explore 308→app.foursquare.com login)
 *
 * SKIPPED (no public consumer POI/review listing — pure data/SDK/API providers):
 *   mapbox, tomtom, here-dev, apple-maps.
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

const full = (description: string) => ({ method: 'full-only' as const, supported: true, description });
const sortNew = (description: string) => ({ method: 'sort-by-updated' as const, supported: true, description });

export const browserMapsApis: BrowserStrategy[] = [
  {
    id: 'hot-pepper-gourmet',
    displayName: 'Hot Pepper Gourmet (web scrape)',
    tier: 'C',
    coverage: 'Japan; ホットペッパーグルメ restaurants, coupons, reservations',
    access:
      'Public hotpepper.jp area listing pages (the Recruit Web Service API is key-gated to Japanese registrants).',
    // SA<area> service-area listing, e.g. SA11 = Tokyo. Default to Tokyo.
    listUrl: (input) => `https://www.hotpepper.jp/${input.region ?? 'SA11'}/`,
    waitFor: 'a[href*="/strJ"]',
    incremental: full(
      'One area listing page per run; diff restaurant set by content_hash. No public updated_since on the listing.',
    ),
    // VERIFIED: shop anchors are https://www.hotpepper.jp/strJ000774806/, name is the link text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/strJ"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                id: a.href.match(/\/(strJ\d+)\//)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
                href: a.href,
              };
            })
            // keep the shop-name anchor; drop empty/duplicate-id chrome links
            .filter((x) => x.id && x.name)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: { href: x.href, name: x.name } })),
        limit,
      ),
  },
  {
    id: 'jalan',
    displayName: 'Jalan (web scrape)',
    tier: 'C',
    coverage: 'Japan; じゃらん sightseeing spots + reviews (kuchikomi)',
    access:
      'Public jalan.net /kankou sightseeing ranking pages (the Jalan Web Service hotel API is key-gated to Japanese registrants).',
    // /kankou/<prefCode>/ ranking page (140000 = Kanagawa). Pass a pref code via region.
    listUrl: (input) => `https://www.jalan.net/kankou/${input.region ?? '140000'}/`,
    waitFor: 'a[href*="/kankou/spt_guide"]',
    incremental: full(
      'One prefecture ranking page per run; diff spot set by content_hash. The kuchikomi review counts are the cheap change signal between runs.',
    ),
    // VERIFIED: spot anchors are /kankou/spt_guide000000179888/ — the bare detail link carries the name;
    // /kuchikomi/ and /activity/ sub-links repeat the id but carry counts/plans, so keep only the detail link per id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/kankou/spt_guide"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; pathname: string; textContent: string | null };
              return {
                id: a.href.match(/spt_guide(\d+)/)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
                href: a.href,
                isDetail: /\/spt_guide\d+\/?$/.test(a.pathname),
              };
            })
            // prefer the bare detail anchor (real name) over /kuchikomi//activity sublinks
            .filter((x) => x.id && x.name && x.isDetail)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({
              sourceId: `spt_guide${x.id}`,
              name: x.name,
              url: x.href,
              raw: { href: x.href, name: x.name },
            })),
        limit,
      ),
  },
  {
    id: 'kakaomap',
    displayName: 'KakaoMap (web scrape)',
    tier: 'C',
    coverage: 'Korea; 카카오맵 place search, reviews, ratings',
    access: 'Public map.kakao.com search results (the Kakao Local REST API is key-gated).',
    listUrl: (input) => `https://map.kakao.com/?q=${encodeURIComponent(input.region ?? '맛집')}`,
    waitFor: '.placelist > li',
    incremental: full('One search page per run; diff place set by content_hash. No public sort-by-new on the list.'),
    // VERIFIED: each .placelist > li has a .link_name (place name) and an a[href*="place.map.kakao.com/<id>"]
    // (stable numeric place id). The name anchor's own href is "#none", so read the id from the place link.
    extract: (page, limit) =>
      page.$$eval(
        '.placelist > li',
        (els, max) =>
          els
            .slice(0, max as number)
            .map((el) => {
              const li = el as unknown as {
                querySelector(sel: string): { href: string; textContent: string | null } | null;
              };
              const placeLink = li.querySelector('a[href*="place.map.kakao.com"]');
              const id = placeLink?.href.match(/place\.map\.kakao\.com\/(\d+)/)?.[1] ?? '';
              const name = (li.querySelector('.link_name')?.textContent ?? '').trim().replace(/\s+/g, ' ');
              const url = id ? `https://place.map.kakao.com/${id}` : (placeLink?.href ?? '');
              return { sourceId: id, name, url, raw: { id, name, url } };
            })
            .filter((x) => x.sourceId && x.name),
        limit,
      ),
  },
  {
    id: 'naver-map',
    displayName: 'Naver Map (web scrape)',
    tier: 'C',
    coverage: 'Korea; 네이버지도 place search, reviews, ratings',
    access: 'Public Naver Place restaurant list (the Naver Maps/Local API is key-gated).',
    // map.naver.com renders the list inside the searchIframe; that iframe is itself a real public
    // page (pcmap.place.naver.com/restaurant/list) that renders the list at the top level — visit it directly.
    listUrl: (input) =>
      `https://pcmap.place.naver.com/restaurant/list?query=${encodeURIComponent(input.region ?? '서울 맛집')}`,
    waitFor: 'li.UEzoS a.place_bluelink',
    incremental: full('One Naver Place list page per run; diff place set by content_hash.'),
    note:
      'Naver anti-bot: from a datacenter IP the list page returns "서비스 이용이 제한되었습니다" (access restricted, shows your IP). Needs BROWSER_PROXY (Korean residential/unblocker).',
    // Naver Place list items are li.UEzoS with the name anchor a.place_bluelink (href → /restaurant/<id>).
    extract: (page, limit) =>
      page.$$eval(
        'li.UEzoS a.place_bluelink',
        (els, max) =>
          els
            .slice(0, max as number)
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                sourceId: a.href.match(/\/restaurant\/(\d+)/)?.[1] ?? a.href.slice(0, 80),
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
                url: a.href,
                raw: { href: a.href, name: (a.textContent ?? '').trim() },
              };
            })
            .filter((x) => x.name),
        limit,
      ),
  },
  {
    id: 'amap',
    displayName: 'Amap / 高德地图 (web scrape)',
    tier: 'C',
    coverage: 'China; 高德地图 POI search, reviews',
    access: 'Public amap.com search results (the AutoNavi/Amap Web Service API is key-gated).',
    // city = adcode (110000 = Beijing). The search SPA reads query + city from the URL.
    listUrl: (input) =>
      `https://www.amap.com/search?query=${encodeURIComponent(input.region ?? '餐厅')}&city=110000`,
    waitFor: 'a[href*="/place/"]',
    incremental: full('One SPA search page per run; diff POI set by content_hash.'),
    note:
      'Amap renders results via signed XHR into a late-hydrated SPA and gates by China IP — a datacenter IP gets an empty/blocked list. Needs BROWSER_PROXY (China residential). If 0 items, the POI panel rendered late; increase wait or target the result container.',
    // Amap POI detail links are /place/<poiId>; the name is the link text. (SPA — selector may need tuning.)
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/place/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                id: a.href.match(/\/place\/([A-Za-z0-9]+)/)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
                href: a.href,
              };
            })
            .filter((x) => x.id && x.name)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: { href: x.href, name: x.name } })),
        limit,
      ),
  },
  {
    id: 'baidu-maps',
    displayName: 'Baidu Maps / 百度地图 (web scrape)',
    tier: 'C',
    coverage: 'China; 百度地图 POI search, reviews',
    access: 'Public map.baidu.com search results (the Baidu Map Place API is key-gated).',
    listUrl: (input) => `https://map.baidu.com/search/${encodeURIComponent(input.region ?? '餐厅')}`,
    waitFor: 'a[href*="/poi/"]',
    incremental: full('One SPA search page per run; diff POI set by content_hash.'),
    note:
      'Baidu Maps renders the result list via signed XHR (the "ak"/sign-walled API) into a canvas-heavy SPA; list anchors are javascript:; from a datacenter IP. Needs BROWSER_PROXY (China residential) and likely selector tuning to the result panel.',
    // Baidu POI detail links carry uid in /poi/...?uid=<hex>; fall back to the poi path segment.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/poi/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              const uid = a.href.match(/[?&]uid=([0-9a-f]+)/i)?.[1] ?? a.href.match(/\/poi\/([^/?#]+)/)?.[1] ?? '';
              return { id: uid, name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), href: a.href };
            })
            .filter((x) => x.id && x.name)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: { href: x.href, name: x.name } })),
        limit,
      ),
  },
  {
    id: 'untappd',
    displayName: 'Untappd (web scrape)',
    tier: 'C',
    coverage: 'Global; beer venues (bars/breweries), check-ins',
    access: 'Public untappd.com venue search (the Untappd API is key-gated / business-tier only).',
    listUrl: (input) => `https://untappd.com/search?q=${encodeURIComponent(input.region ?? 'Penang')}&type=venues`,
    waitFor: 'a[href*="/v/"]',
    incremental: full('One venue search page per run; diff venue set by content_hash.'),
    note:
      'Cloudflare-managed: from a datacenter IP the search page returns HTTP 403 "Just a moment…". Needs BROWSER_PROXY (residential/unblocker).',
    // Venue pages are /v/<slug>/<numericId> — derive the stable numeric venue id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/v/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              const m = a.href.match(/\/v\/([^/]+)\/(\d+)/);
              return {
                id: m?.[2] ?? '',
                slug: m?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
                href: a.href,
              };
            })
            .filter((x) => x.id && x.name)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: { href: x.href, slug: x.slug } })),
        limit,
      ),
  },
  {
    id: 'expedia-hotels-com',
    displayName: 'Hotels.com (web scrape)',
    tier: 'C',
    coverage: 'Global; hotels, reviews, ratings (Expedia Group)',
    access:
      'Public hotels.com property search list (the Expedia Rapid/partner API is key-gated and licence-gated).',
    listUrl: (input) =>
      `https://www.hotels.com/Hotel-Search?destination=${encodeURIComponent(input.region ?? 'Penang, Malaysia')}`,
    waitFor: 'a[data-stid="open-hotel-information"]',
    incremental: full('One property search page per run; diff property set by content_hash.'),
    note:
      'Expedia-family bot wall (PerimeterX): from a datacenter IP returns HTTP 429 "Bot or Not?". Needs BROWSER_PROXY (residential/unblocker).',
    // Property cards link via a[data-stid="open-hotel-information"]; the property id is in /ho<digits>/ or the hotelId param.
    extract: (page, limit) =>
      page.$$eval(
        'a[data-stid="open-hotel-information"]',
        (els, max) =>
          els
            .slice(0, max as number)
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null; getAttribute(n: string): string | null };
              const id =
                a.href.match(/\/ho(\d+)/)?.[1] ??
                a.href.match(/[?&]hotelId=(\d+)/)?.[1] ??
                a.href.slice(0, 80);
              const name = (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ');
              return { sourceId: id, name, url: a.href, raw: { href: a.href, name } };
            })
            .filter((x) => x.sourceId && x.name),
        limit,
      ),
  },
  {
    id: 'google-hotels',
    displayName: 'Google Hotels (web scrape)',
    tier: 'C',
    coverage: 'Global; hotel meta-search, prices, reviews',
    access:
      'Public google.com/travel/search hotel results (the Hotel Center/Content API is partner-gated).',
    listUrl: (input) =>
      `https://www.google.com/travel/search?q=${encodeURIComponent('hotels in ' + (input.region ?? 'George Town Penang'))}`,
    waitFor: 'a[href*="/travel/hotels/"]',
    consentSelectors: ['button[aria-label*="Accept"]', 'button:has-text("Accept all")', 'form[action*="consent"] button'],
    incremental: full(
      'No web sort-by-new; one results page per run, diff by content_hash. Use the partner Content API for change dates if available.',
    ),
    note:
      'Google Travel is a heavy SPA; hotel cards carry the name in aria-label (not link text). Plain Chrome from a datacenter IP may hit a consent/interstitial — needs the consent click and possibly BROWSER_PROXY.',
    // Hotel entity links are /travel/hotels/<slug>; the name lives in aria-label.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/travel/hotels/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null; getAttribute(n: string): string | null };
              const slug = decodeURIComponent(a.href.match(/\/travel\/hotels\/([^/?#]+)/)?.[1] ?? '');
              const name = (a.getAttribute('aria-label') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ');
              return { id: slug, name, href: a.href };
            })
            .filter((x) => x.id && x.name)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id.slice(0, 80), name: x.name, url: x.href, raw: { href: x.href, name: x.name } })),
        limit,
      ),
  },
  {
    id: 'foursquare',
    displayName: 'Foursquare (web scrape)',
    tier: 'C',
    coverage: 'Global; venues, tips, ratings',
    access:
      'Public foursquare.com venue surface (the Foursquare Places API is key-gated; consumer City Guide web was sunset Apr 2025).',
    // foursquare.com/explore 308-redirects to the app.foursquare.com SPA. There is no anonymous listing
    // page left, but the venue search SPA still renders venue cards once past the login/consent wall.
    listUrl: (input) =>
      `https://foursquare.com/explore?mode=url&near=${encodeURIComponent(input.region ?? 'Penang')}&q=${encodeURIComponent('restaurants')}`,
    waitFor: 'a[href*="/v/"]',
    incremental: sortNew('Explore can be ordered by recency; one page per run, diff by content_hash otherwise.'),
    note:
      'foursquare.com/explore 308→app.foursquare.com, which shows a "Log in to Foursquare" wall (City Guide web sunset Apr 2025). Needs an authenticated session/cookie and/or BROWSER_PROXY; without login the venue list does not render.',
    // Legacy venue pages are /v/<slug>/<24-hex-id>; map whatever venue anchors render post-login.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/v/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              const m = a.href.match(/\/v\/([^/]+)\/([0-9a-f]{8,})/i);
              return { id: m?.[2] ?? '', slug: m?.[1] ?? '', name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), href: a.href };
            })
            .filter((x) => x.id && x.name)
            .filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: { href: x.href, slug: x.slug } })),
        limit,
      ),
  },
];
