/**
 * Browser-scrape strategies — China + Korea cluster (cn-kr).
 *
 * Scrape the public consumer website like a normal user: ONE page, ONE visit per
 * run, human-like dwell/scroll, NO pagination. Each extractor reads the result
 * items off the single listing/search page and derives a STABLE sourceId from the
 * site's own id/slug in the href.
 *
 * Reality of this cluster:
 *   - Most China sites (dianping, xiaohongshu, meituan, fliggy, qyer, mafengwo,
 *     ctrip/trip, qunar, tongcheng) sit behind enterprise anti-bot (DataDome-class,
 *     Alibaba/Tencent bot managers, glyph obfuscation, or signed-request walls) and
 *     are geofenced. Plain Chrome from a datacenter IP is challenged/blocked, so each
 *     carries a `note` flagging the wall and that BROWSER_PROXY (a residential proxy /
 *     unblocker, ideally a China/HK egress) is required. The framework detects the
 *     challenge at runtime and reports `blocked` with the escalation path.
 *   - Korea sites (catchtable, yanolja, goodchoice) are JS/SPA-rendered consumer
 *     listings; selectors target the result anchors that hydrate on load.
 *
 * Selectors target the listing anchors; if 0 items the SPA likely rendered late
 * (raise the wait) — drill that down per source separately.
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

const full = (desc: string) => ({ method: 'full-only' as const, supported: true, description: desc });
const sortNew = (desc: string) => ({ method: 'sort-by-updated' as const, supported: true, description: desc });
const noneInc = (desc: string) => ({ method: 'none' as const, supported: false, description: desc });

const CN_PROXY =
  'China-geofenced + anti-bot: plain Chrome from a datacenter IP is challenged/blocked. Needs BROWSER_PROXY (residential / China or HK egress / unblocker).';

export const browserCnKr: BrowserStrategy[] = [
  {
    id: 'dianping',
    displayName: '大众点评 / Dianping (web scrape)',
    tier: 'E',
    coverage: 'China; restaurants/POIs, ratings & reviews (zh-CN)',
    access: 'Public dianping.com search/shop list (JSON APIs are signed; no public data API).',
    // City search: /search/keyword/<cityId>/0_<keyword>. 2 = Beijing.
    listUrl: (input) =>
      `https://www.dianping.com/search/keyword/2/0_${encodeURIComponent(input.region ?? '美食')}`,
    waitFor: 'a[href*="/shop/"]',
    incremental: full('One city search page per run; diff shop set by content_hash. No public sort-by-new.'),
    note:
      'HARD WALL: Dianping uses glyph/SVG font obfuscation on numbers + signed API params + Tencent anti-bot. ' +
      CN_PROXY,
    // Shop detail = /shop/<id> (numeric or alnum). Name is the anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/shop/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/shop\//.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (r.href.match(/\/shop\/([^/?#]+)/)?.[1] ?? r.href).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'xiaohongshu',
    displayName: '小红书 / RED Xiaohongshu (web scrape)',
    tier: 'E',
    coverage: 'China; lifestyle/travel notes (笔记), POIs & reviews (zh-CN)',
    access: 'Public xiaohongshu.com search-result note cards (content APIs are xsec_token-signed).',
    listUrl: (input) =>
      `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(input.region ?? '美食')}`,
    waitFor: 'a[href*="/explore/"], a[href*="/discovery/item/"]',
    incremental: noneInc('Signed APIs + xsec_token prevent enumeration and there is no timestamped public feed — cannot compute a since-delta.'),
    note:
      'HARD WALL: every content request needs an xsec_token + device-fingerprint signature, and robots.txt is Disallow:/. ' +
      CN_PROXY,
    // Note detail = /explore/<noteId> or /discovery/item/<noteId>; title carries the name.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/explore/"], a[href*="/discovery/item/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const name = (a.getAttribute('title') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ');
              return { href: a.href, name };
            })
            .filter((x) => x.href)
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (r.href.match(/\/(?:explore|discovery\/item)\/([0-9a-f]+)/)?.[1] ?? r.href).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'qyer',
    displayName: '穷游 / Qyer (web scrape)',
    tier: 'E',
    coverage: 'China-outbound; overseas POIs/attractions & guides (zh-CN)',
    access: 'Public place.qyer.com city POI lists (no public data API; ToS reserves rights).',
    // City place hub: place.qyer.com/<city-slug>/ ; default to a well-known outbound city.
    listUrl: (input) => `https://place.qyer.com/${encodeURIComponent(input.region ?? 'penang')}/`,
    waitFor: 'a[href*="/poi/"]',
    incremental: full('One city POI hub page per run; diff POI set by content_hash. (Sitemap <lastmod> exists but we stay 1-page.)'),
    note: 'WAF: Qyer returns 503 to datacenter IPs. Needs BROWSER_PROXY (residential).',
    // POI detail = place.qyer.com/poi/<id>/ (or /place/poi/<id>/ on m.). Name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/poi/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/poi\/\d+/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: r.href.match(/\/poi\/(\d+)/)?.[1] ?? r.href.slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'mafengwo',
    displayName: '马蜂窝 / Mafengwo (web scrape)',
    tier: 'E',
    coverage: 'China + outbound; attractions/POIs & travel notes (zh-CN)',
    access: 'Public mafengwo.cn destination POI lists (open platform is commerce-only; UGC not egressed).',
    // Destination travel-guide page lists POIs: /jd/<mddId>/gonglve.html (10065 = 鼓浪屿/Xiamen area sample).
    listUrl: (input) => `https://www.mafengwo.cn/jd/${encodeURIComponent(input.region ?? '10065')}/gonglve.html`,
    waitFor: 'a[href*="/poi/"]',
    incremental: full('One destination POI page per run; diff POI set by content_hash.'),
    note: 'WAF + anti-bot on mafengwo.cn. Needs BROWSER_PROXY (residential / China egress).',
    // POI detail = /poi/<id>.html ; name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/poi/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/poi\/\d+\.html/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: r.href.match(/\/poi\/(\d+)\.html/)?.[1] ?? r.href.slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'ctrip',
    displayName: '携程 / Ctrip (web scrape)',
    tier: 'D',
    coverage: 'China; hotels/attractions, ratings & reviews (zh-CN)',
    access: 'Public you.ctrip.com attraction lists (supplier/affiliate APIs do not egress catalog/reviews).',
    // Sight (attraction) list per city: you.ctrip.com/sight/<cityPinyin><id>.html
    listUrl: (input) => `https://you.ctrip.com/sight/${encodeURIComponent(input.region ?? 'beijing1')}.html`,
    waitFor: 'a[href*="/sight/"]',
    incremental: full('One city attraction list page per run; diff by content_hash.'),
    note: 'WAF/anti-bot on ctrip.com (geofenced). Needs BROWSER_PROXY (residential / China or HK egress).',
    // Sight detail = you.ctrip.com/sight/<city>/<poiId>.html ; name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/sight/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/sight\/[^/]+\/\d+\.html/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: r.href.match(/\/sight\/[^/]+\/(\d+)\.html/)?.[1] ?? r.href.slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'qunar',
    displayName: '去哪儿 / Qunar (web scrape)',
    tier: 'D',
    coverage: 'China; hotels metasearch, ratings & reviews (zh-CN)',
    access: 'Public hotel.qunar.com city hotel lists (supplier gateway does not egress catalog to third parties).',
    listUrl: (input) =>
      `https://hotel.qunar.com/city/${encodeURIComponent(input.region ?? 'beijing_city')}/`,
    waitFor: 'a[href*="/detail"], a[href*="hotelDetail"]',
    incremental: full('One city hotel list page per run; diff hotel set by content_hash.'),
    note: 'WAF/anti-bot on qunar.com (geofenced); list hydrates via signed XHR. Needs BROWSER_PROXY (residential / China egress).',
    // Hotel detail carries the hotelSeq / id in the href query or path.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/detail"], a[href*="hotelDetail"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && x.href)
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (
                r.href.match(/[?&](?:hotelSeq|seq|id|cityUrl)=([^&#]+)/)?.[1] ??
                r.href.match(/\/([0-9A-Za-z_-]{6,})(?:\.html)?(?:[?#]|$)/)?.[1] ??
                r.href
              ).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'tongcheng',
    displayName: '同程 / Tongcheng LY.com (web scrape)',
    tier: 'D',
    coverage: 'China; hotels/attractions, ratings & reviews (zh-CN)',
    access: 'Public www.ly.com/hotel/hotellist (supplier distribution does not egress catalog to third parties).',
    listUrl: (input) =>
      `https://www.ly.com/hotel/hotellist?city=${encodeURIComponent(input.region ?? '700')}`,
    waitFor: 'a[href*="hoteldetail"], a[href*="/hotel/"]',
    incremental: full('One city hotel list page per run; diff hotel set by content_hash.'),
    note: 'WAF/anti-bot on ly.com (geofenced); SPA list hydrates late. Needs BROWSER_PROXY (residential / China egress).',
    // Hotel detail = www.ly.com/hotel/hoteldetail?hotelId=<id> ; name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="hoteldetail"], a[href*="/hotel/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /hoteldetail/i.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (
                r.href.match(/[?&](?:hotelId|hotelid|id)=([^&#]+)/i)?.[1] ?? r.href
              ).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'fliggy',
    displayName: '飞猪 / Fliggy (web scrape)',
    tier: 'D',
    coverage: 'China; hotels/attractions/tickets (Alibaba travel) (zh-CN)',
    access: 'Public fliggy.com search-result item cards (Taobao Open Platform does not egress travel POI/review data).',
    listUrl: (input) =>
      `https://www.fliggy.com/search?searchType=hotel&keyword=${encodeURIComponent(input.region ?? '酒店')}`,
    waitFor: 'a[href*="traveldetail"], a[href*="item.htm"]',
    incremental: full('One search page per run; diff item set by content_hash.'),
    note:
      'HARD WALL: Alibaba Bot Manager (acw_sc / x5sec) + login prompts on fliggy.com. ' +
      CN_PROXY,
    // Item detail = traveldetail.fliggy.com/item.htm?id=<numericId> ; name is anchor text/title.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="traveldetail"], a[href*="item.htm"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const name = (a.getAttribute('title') ?? a.textContent ?? '').trim().replace(/\s+/g, ' ');
              return { href: a.href, name };
            })
            .filter((x) => /[?&]id=\d+/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: r.href.match(/[?&]id=(\d+)/)?.[1] ?? r.href.slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'meituan',
    displayName: '美团 / Meituan (web scrape)',
    tier: 'E',
    coverage: 'China; restaurants/deals/POIs, ratings & reviews (zh-CN)',
    access: 'Public meituan.com category list (open platform serves merchant ops, not a catalog/review feed).',
    // City + category food list: <cityPinyin>.meituan.com/meishi/
    listUrl: (input) =>
      `https://${encodeURIComponent(input.region ?? 'bj')}.meituan.com/meishi/`,
    waitFor: 'a[href*="/meishi/"]',
    incremental: full('One city category list page per run; diff poi set by content_hash.'),
    note:
      'HARD WALL: Meituan uses _token/mtgsig signed params + sliding-captcha anti-bot (Tencent-class). ' +
      CN_PROXY,
    // POI detail = <city>.meituan.com/meishi/<id>/ ; name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/meishi/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/meishi\/\d+/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: r.href.match(/\/meishi\/(\d+)/)?.[1] ?? r.href.slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'catchtable',
    displayName: 'CatchTable / 캐치테이블 (web scrape)',
    tier: 'D',
    coverage: 'Korea; restaurant reservations, ratings & reviews (ko-KR)',
    access: 'Public catchtable.net/shop list (no public developer API; merchant/POS-gated).',
    // Global consumer web shop directory.
    listUrl: () => 'https://www.catchtable.net/shop/',
    waitFor: 'a[href*="/shop/"]',
    incremental: full('One shop-directory page per run; diff shop set by content_hash. (Sitemap <lastmod> exists but we stay 1-page.)'),
    note: 'SPA — shop cards hydrate after load; if 0 items raise the wait / target the result container.',
    // Shop detail = catchtable.net/shop/<slug> ; slug like "suksungdo_jeju". Name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/shop/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/shop\/[^/?#]+/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (r.href.match(/\/shop\/([^/?#]+)/)?.[1] ?? r.href).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'yanolja',
    displayName: 'Yanolja / NOL 야놀자 (web scrape)',
    tier: 'D',
    coverage: 'Korea; accommodations/leisure, ratings & reviews (ko-KR)',
    access: 'Public nol.yanolja.com accommodation lists (B2B Cloud APIs serve an operator its own data only).',
    // Consumer sub-home for hotels (verticalCategory=LOCAL_ACCOMMODATION).
    listUrl: () =>
      'https://nol.yanolja.com/sub-home/hotel?verticalCategory=LOCAL_ACCOMMODATION&verticalSubCategory=HOTEL',
    waitFor: 'a[href*="/stay/"]',
    incremental: full('One accommodation sub-home page per run; diff property set by content_hash.'),
    note: 'SPA — property cards hydrate after load; if 0 items raise the wait.',
    // Detail = /stay/domestic/<id> or /stay/overseas/TDP-<id> ; name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/stay/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/stay\/(?:domestic|overseas)\//.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (r.href.match(/\/stay\/(?:domestic|overseas)\/([^/?#]+)/)?.[1] ?? r.href).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
  {
    id: 'yeogi-goodchoice',
    displayName: '여기어때 / GoodChoice (web scrape)',
    tier: 'D',
    coverage: 'Korea; accommodations, ratings & reviews (ko-KR)',
    access: 'Public msearch.goodchoice.kr listings (Partner Center serves an operator its own ops only; no public API).',
    // Mobile consumer web search home; region drives the keyword.
    listUrl: (input) =>
      `https://msearch.goodchoice.kr/v2/search?keyword=${encodeURIComponent(input.region ?? '서울')}`,
    waitFor: 'a[href*="/product/"], a[href*="/hotel/"]',
    incremental: full('One search page per run; diff property set by content_hash.'),
    note: 'SPA + anti-bot on goodchoice.kr; cards hydrate after load. If 0 items / challenged, set BROWSER_PROXY (residential) and raise the wait.',
    // Detail = msearch.goodchoice.kr/product/<id> (or /hotel/<id>) ; name is anchor text.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/product/"], a[href*="/hotel/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { href: a.href, name: (a.textContent ?? '').trim().replace(/\s+/g, ' ') };
            })
            .filter((x) => x.name && /\/(?:product|hotel)\/\d+/.test(x.href))
            .slice(0, max as number)
            .map((r) => ({
              sourceId: (r.href.match(/\/(?:product|hotel)\/(\d+)/)?.[1] ?? r.href).slice(0, 80),
              name: r.name,
              url: r.href,
              raw: r,
            })),
        limit,
      ),
  },
];
