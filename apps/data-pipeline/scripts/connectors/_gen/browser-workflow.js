export const meta = {
  name: 'gen-browser-strategies',
  description: 'Author one-page browser-scrape strategies for gated/blocked sources',
  phases: [{ title: 'Generate', detail: 'one agent per cluster authors BrowserStrategy[] with real selectors' }],
}

const CONTRACT = `
You are authoring browser-scrape strategies for a travel-data prototype. The user HOLDS scraping
agreements for these public sites — ignore ToS/copyright; focus purely on TECHNICAL doability.
Scrape like a NORMAL USER: exactly ONE page, ONE visit per source per run. NO pagination, NO
multi-page crawling. The framework already adds human dwell/scroll + pacing + challenge detection.

Output ONE ES module (NodeNext, .js import specifiers) ending with:
  export const <EXPORT_NAME>: BrowserStrategy[] = [ ... ];

IMPORTS (only these):
  import { type BrowserStrategy } from '../core/browser-connector.js';
  import type { Page } from 'playwright';

BrowserStrategy = {
  id: string;                       // kebab id shown per source
  displayName: string;              // e.g. 'Zomato (web scrape)'
  tier: 'A'|'B'|'C'|'D'|'E';
  coverage: string;                 // region/lang one-liner
  access: string;                   // why we scrape (no API / key-gated / licence-gated) + the public URL kind
  listUrl: (input: { region?: string; sinceTimestamp?: string; limit?: number }) => string;  // ONE real public listing/search URL
  waitFor?: string;                 // CSS selector to await before extracting
  consentSelectors?: string[];      // extra cookie/consent buttons to click (optional)
  incremental: { method: 'sort-by-updated'|'full-only'|'sitemap-lastmod'|'none'; supported: boolean; description: string };
  extract: (page: Page, limit: number) => Promise<Array<{ sourceId: string; name?: string; lat?: number; lng?: number; url?: string; updated_at?: string; raw?: unknown }>>;
  note?: string;                    // e.g. WAF warning + 'needs BROWSER_PROXY'
};

extract MUST use page.$$eval (runs in the browser) to map result elements to items, sliced to \`limit\`.
Derive a STABLE sourceId per item (the site's own id/slug from the href, e.g. /biz/<slug>, -d<digits>-, /firm/<id>).
Read the visible name (textContent, or an attribute like aria-label/title where the name isn't text).

VERIFIED PATTERNS (copy this shape):
  // text-anchor sites (name is the link text):
  extract: (page, limit) => page.$$eval('a.SELECTOR', (els, max) => els.slice(0, max as number).map((e) => {
    const a = e as HTMLAnchorElement;
    return { sourceId: (a.href.match(/\\/biz\\/([^/?#]+)/)?.[1] ?? a.href).slice(0,80), name: (a.textContent ?? '').trim().replace(/\\s+/g,' '), url: a.href, raw: { href: a.href } };
  }), limit),
  // aria-label sites (Google Maps style): read getAttribute('aria-label') for the name.

RULES:
1. Use WebSearch/WebFetch to find the CURRENT public listing/search URL and the REAL CSS selector for result items. Do NOT invent selectors — verify against the live HTML where you can.
2. ONE page only. listUrl returns a single search/listing URL (use input.region for the query/area when sensible, with a sensible default).
3. For sources known to use DataDome (Yelp/TripAdvisor-family) or Cloudflare-managed (Atlas Obscura/AllTrails-family) or signed-request walls (Dianping/Xiaohongshu/Douyin), STILL author the strategy, but set note to flag the wall and that BROWSER_PROXY (residential/unblocker) is required. The framework detects the challenge at runtime.
4. incremental: 'sort-by-updated' if the listing can be ordered by newest; else 'full-only' (diff by content_hash) or 'sitemap-lastmod'.
5. SKIP sources that have NO public consumer website listing POIs/reviews (pure data/API providers, e.g. mapbox/tomtom/here/apple-maps/safegraph/placer.ai/factual/ATDW/TXGB/Visit Finland/Wikimedia Enterprise). Put these in the 'skipped' array with a reason — do NOT fabricate a scrape for them.
6. Compilable TS; no imports beyond the two above; no 'any' that breaks build; extractor logic lives inside $$eval.

Already implemented elsewhere (DO NOT include): google-maps, tabelog, wongnai, 2gis, yelp, tripadvisor, atlas-obscura-web.
`

const SCHEMA = {
  type: 'object',
  properties: {
    exportName: { type: 'string' },
    filename: { type: 'string' },
    code: { type: 'string' },
    strategies: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, listUrl: { type: 'string' }, selector: { type: 'string' }, expectedOutcome: { type: 'string' }, note: { type: 'string' } },
        required: ['id', 'listUrl', 'expectedOutcome'],
      },
    },
    skipped: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, reason: { type: 'string' } }, required: ['id', 'reason'] } },
  },
  required: ['exportName', 'filename', 'code', 'strategies'],
}

const CLUSTERS = [
  { key: 'maps-apis', exportName: 'browserMapsApis', filename: 'maps-apis.ts',
    sources: 'foursquare (foursquare.com/explore or place pages), untappd (untappd.com/search venues), expedia/hotels.com (hotels.com reviews list), amap (amap.com / ditu.amap.com — China), baidu-maps (map.baidu.com — China), naver-map (map.naver.com — Korea), kakaomap (map.kakao.com — Korea), hot-pepper-gourmet (hotpepper.jp — Japan), jalan (jalan.net — Japan), google-hotels (google.com/travel/hotels). SKIP: mapbox, tomtom, here-dev, apple-maps (no public POI listing site).' },
  { key: 'licensable', exportName: 'browserLicensable', filename: 'licensable.ts',
    sources: 'reddit (old.reddit.com/r/travel/new or reddit.com/r/travel.json — public listing), retty (retty.me area lists — Japan), siksin (siksinhot.com — Korea), navitime (navitime.co.jp spot pages — Japan), jorudan (jorudan.co.jp), time-out (timeout.com/<city>/restaurants), lonely-planet (lonelyplanet.com/<place> POIs). SKIP: safegraph, placer-ai, here-bulk, wikimedia-enterprise, yelp-data-licensing (data/API providers, no consumer POI listing).' },
  { key: 'ota', exportName: 'browserOta', filename: 'ota.ts',
    sources: 'booking-com (booking.com/searchresults or hotel review pages), agoda (agoda.com), klook (klook.com/en-US/search), getyourguide (getyourguide.com/s), viator (viator.com search), thefork (thefork.com lists), opentable (opentable.com/s), resy (resy.com/cities), hostelworld (hostelworld.com), trip-com (trip.com), traveloka (traveloka.com), chope (chope.co), michelin-guide (guide.michelin.com/en/restaurants).' },
  { key: 'cn-kr', exportName: 'browserCnKr', filename: 'cn-kr.ts',
    sources: 'dianping (dianping.com — heavy anti-bot/glyph-obfuscation, WAF note), xiaohongshu (xiaohongshu.com — signed-request wall, WAF note), qyer (qyer.com), mafengwo (mafengwo.cn), ctrip (ctrip.com / trip.com China), qunar (qunar.com), tongcheng (ly.com), fliggy (fliggy.com), meituan (meituan.com — WAF note), catchtable (catchtable.co.kr — Korea), yanolja (yanolja.com — Korea), yeogi-goodchoice (goodchoice.kr — Korea). Most China sites need BROWSER_PROXY (China IP / anti-bot) — set note.' },
  { key: 'asia-community', exportName: 'browserAsiaCommunity', filename: 'asia-community.ts',
    sources: 'zomato (zomato.com/<city>/restaurants), swiggy-dineout (swiggy.com/dineout), magicpin (magicpin.in/<city>), burpple (burpple.com — SG/MY), hungrygowhere (hungrygowhere.com — SG), foody-shopeefood (foody.vn), eatigo (eatigo.com), qraved (qraved.com — Indonesia), diningcode (diningcode.com — Korea).' },
  { key: 'global-community', exportName: 'browserGlobalCommunity', filename: 'global-community.ts',
    sources: 'happycow (happycow.net/<region> — may be Cloudflare, WAF note), culture-trip (theculturetrip.com), airbnb (airbnb.com/s/<place>/homes — heavy anti-bot, WAF note), tripadvisor-forums (tripadvisor.com/ShowForum — DataDome family, WAF note), foursquare-consumer (foursquare.com/city-guide), jnto-content (japan.travel/en), alltrails (alltrails.com/<region> — DataDome, WAF note).' },
  { key: 'russia-mena', exportName: 'browserRussiaMena', filename: 'russia-mena.ts',
    sources: 'yandex-maps (yandex.com/maps — SPA, may need long wait), yandex-eda (eda.yandex), talabat (talabat.com/<country>/restaurants), sygic-travel (travel.sygic.com/en — trip planner POIs).' },
]

phase('Generate')
const results = await parallel(
  CLUSTERS.map((cluster) => () =>
    agent(
      `${CONTRACT}\n\n=== CLUSTER: ${cluster.key} ===\nAuthor BrowserStrategy[] (export const ${cluster.exportName}) in file ${cluster.filename} for these sources:\n${cluster.sources}\n\nVerify the listing URL + selectors via WebFetch where possible. Return exportName='${cluster.exportName}', filename='${cluster.filename}', the full module code, a per-strategy summary, and a 'skipped' list for any data-only sources.`,
      { label: `browser:${cluster.key}`, phase: 'Generate', schema: SCHEMA },
    ),
  ),
)

const ok = results.filter(Boolean)
log(`Generated ${ok.length}/${CLUSTERS.length} browser-strategy modules; ${ok.reduce((a, r) => a + (r.strategies?.length ?? 0), 0)} strategies`)
return { modules: ok }
