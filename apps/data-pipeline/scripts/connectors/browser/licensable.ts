/**
 * Browser-scrape strategies — CLUSTER: licensable.
 *
 * Sources whose data is normally key-/licence-gated (or has no consumer API) but
 * which publish a PUBLIC consumer listing we can read like a normal user: ONE page,
 * ONE visit per run, no pagination. The framework adds human dwell/scroll + pacing +
 * challenge detection; extractors below must stay single-page and slice to `limit`.
 *
 * Verified live (June 2026) for the listing URL + result-anchor shape:
 *   - retty        retty.me/area/<PRE>/ ........ <a href="/area/PRE../ARE../SUB../<digits>/">
 *   - navitime     navitime.co.jp/category/...... <a href="//www.navitime.co.jp/poi?spot=<id>">
 *   - jorudan      next.jorudan.co.jp/trv/<pref>/ <a href="/trv/<pref>/<digits>.html">
 *   - time-out     timeout.com/<city>/restaurants <a href="/<city>/restaurants/<slug>">
 *   - lonely-planet lonelyplanet.com/<place>/attractions <a href=".../a/poi-sig/<id>/...">
 *   - reddit       reddit.com/r/<sub>/new.json .. JSON listing (read like a user, no auth)
 *   - siksin       siksinhot.com/search?keyword= <a href="/P/<id>"> (datacenter-IP walled)
 *
 * SKIPPED (no public consumer POI/review listing — pure data/API providers): safegraph,
 * placer-ai, here-bulk, wikimedia-enterprise, yelp-data-licensing. See `skipped` in output.
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

const full = (description: string) =>
  ({ method: 'full-only' as const, supported: true, description });
const sortNew = (description: string) =>
  ({ method: 'sort-by-updated' as const, supported: true, description });

export const browserLicensable: BrowserStrategy[] = [
  {
    id: 'reddit',
    displayName: 'Reddit (r/travel — public listing)',
    tier: 'B',
    coverage: 'Global, EN; travel discussion / recommendations (r/travel)',
    access:
      'Public reddit.com/r/<sub>/new.json listing (alternative to the OAuth-gated Data API). Read like a normal user: one /new listing per run.',
    // ONE page: the newest-first JSON listing. input.region can override the subreddit (e.g. "JapanTravel").
    listUrl: (input) => {
      const sub = (input.region ?? 'travel').replace(/^r\//, '').replace(/[^A-Za-z0-9_]/g, '');
      const lim = Math.min(input.limit ?? 25, 100);
      return `https://www.reddit.com/r/${sub || 'travel'}/new.json?limit=${lim}&raw_json=1`;
    },
    waitFor: 'pre, body',
    incremental: sortNew(
      'sort=new listing: production stores the newest t3_ fullname and passes before=<fullname> to fetch only posts newer than last run. One listing page per run here.',
    ),
    note: 'JSON endpoint: Reddit may rate-limit / 429 datacenter IPs — set BROWSER_PROXY (residential) if the body is an HTML block page rather than JSON.',
    // The listing is JSON rendered into the page body — parse document text in-browser.
    extract: (page, limit) =>
      page.$$eval('body', (els, max) => {
        const txt = (els[0]?.textContent ?? '').trim();
        let json: unknown;
        try {
          json = JSON.parse(txt);
        } catch {
          return [];
        }
        type Child = { kind?: string; data?: Record<string, unknown> };
        const root = json as { data?: { children?: Child[] } };
        const children = root?.data?.children ?? [];
        return children
          .map((c) => c?.data ?? {})
          .filter((d) => typeof d.name === 'string')
          .slice(0, max as number)
          .map((d) => {
            const name = String(d.name); // t3_xxxxx fullname — stable id
            const permalink = typeof d.permalink === 'string' ? d.permalink : '';
            const created =
              typeof d.created_utc === 'number'
                ? new Date(d.created_utc * 1000).toISOString()
                : undefined;
            return {
              sourceId: name,
              name: (typeof d.title === 'string' ? d.title : '').slice(0, 200),
              url: permalink ? `https://www.reddit.com${permalink}` : String(d.url ?? ''),
              updated_at: created,
              raw: {
                id: name,
                title: d.title,
                permalink,
                url: d.url,
                subreddit: d.subreddit,
                created_utc: d.created_utc,
              },
            };
          });
      }, limit),
  },
  {
    id: 'retty',
    displayName: 'Retty (web scrape)',
    tier: 'B',
    coverage: 'Japan, JA; restaurant listings + reviews',
    access:
      'Public retty.me area listing pages (the restaurant data otherwise ships as the B2B "Food Data Platform" licence). One area page per run.',
    // ONE page: a prefecture/area list. input.region = a Retty area code path, default PRE13 (Tokyo).
    listUrl: (input) => `https://retty.me/area/${input.region ?? 'PRE13'}/`,
    waitFor: 'a[href*="/area/"][href*="/SUB"]',
    incremental: full(
      'No public sort-by-new on the area list; one area page per run, diff the restaurant set by content_hash. Production licenses the Food Data Platform delivery for true deltas.',
    ),
    // Restaurant links: /area/PRE../ARE../SUB../<restaurantId>/ — the trailing digits are the stable id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/area/"][href*="/SUB"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                href: a.href,
                id: a.href.match(/\/SUB\d+\/(\d+)\/?$/)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              };
            })
            .filter((x) => x.id && x.name)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: x })),
        limit,
      ),
  },
  {
    id: 'siksin',
    displayName: 'Siksin / SiksinHot (web scrape)',
    tier: 'B',
    coverage: 'Korea, KO; restaurant ("hot place") listings + reviews',
    access:
      'Public siksinhot.com keyword search results (the restaurant big-data set is otherwise a B2B partner licence). One search page per run.',
    // ONE page: keyword search. input.region used as the Korean area keyword, default 서울 (Seoul).
    listUrl: (input) =>
      `https://www.siksinhot.com/search?keyword=${encodeURIComponent(input.region ?? '서울')}`,
    waitFor: 'a[href*="/P/"]',
    incremental: full(
      'One search page per run; diff the store set by content_hash. Production licenses the partner big-data dataset (versioned dump-diff) for true deltas.',
    ),
    note: 'SiksinHot 403s datacenter IPs (confirmed): needs BROWSER_PROXY (residential). The store-detail selector a[href*="/P/"] should be re-confirmed on the first headed run behind the proxy; tune to the result-card link if 0 items.',
    // Store detail links: /P/<storeId> — capture the id segment after /P/.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/P/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                href: a.href,
                id: a.href.match(/\/P\/(\d+)/)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              };
            })
            .filter((x) => x.id)
            .slice(0, max as number)
            .map((x) => ({
              sourceId: x.id,
              name: x.name || undefined,
              url: x.href,
              raw: x,
            })),
        limit,
      ),
  },
  {
    id: 'navitime',
    displayName: 'NAVITIME (web scrape)',
    tier: 'B',
    coverage: 'Japan, JA; transit POIs / spots directory',
    access:
      'Public navitime.co.jp spot category listing pages (POI data otherwise sits behind the commercial B2B API). One category page per run.',
    // ONE page: a spot category listing. input.region = NAVITIME category+area path, default cafe (0301) in Tokyo (13).
    listUrl: (input) => `https://www.navitime.co.jp/category/${input.region ?? '0301/13'}/`,
    waitFor: 'a[href*="/poi?spot="]',
    incremental: full(
      'One category listing page per run; diff the spot set by content_hash. Contracted POI datasets are versioned per delivery for true deltas.',
    ),
    // Spot links: //www.navitime.co.jp/poi?spot=<id> — the spot= param is the stable id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/poi?spot="]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                href: a.href,
                id: a.href.match(/[?&]spot=([^&#]+)/)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              };
            })
            .filter((x) => x.id && x.name)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: x })),
        limit,
      ),
  },
  {
    id: 'jorudan',
    displayName: 'Jorudan (web scrape)',
    tier: 'B',
    coverage: 'Japan, JA; tourism spots ("旅の思い出" travel guide)',
    access:
      'Public next.jorudan.co.jp/trv tourism-spot listing pages (route/timetable data otherwise needs the commercial Biz licence). One prefecture list per run.',
    // ONE page: a prefecture tourism-spot list. input.region = prefecture slug, default nagano.
    listUrl: (input) => `https://next.jorudan.co.jp/trv/${input.region ?? 'nagano'}/`,
    waitFor: 'a[href*="/trv/"]',
    incremental: full(
      'One prefecture spot list per run; diff the spot set by content_hash. Jorudan exposes no public updated_since on the guide.',
    ),
    // Spot links: /trv/<pref>/<spotId>.html — the digits before .html are the stable id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/trv/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              return {
                href: a.href,
                id: a.href.match(/\/trv\/[^/]+\/(\d+)\.html/)?.[1] ?? '',
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              };
            })
            .filter((x) => x.id && x.name)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name, url: x.href, raw: x })),
        limit,
      ),
  },
  {
    id: 'time-out',
    displayName: 'Time Out (web scrape)',
    tier: 'B',
    coverage: 'Global cities, EN; restaurant / venue editorial',
    access:
      'Public timeout.com/<city>/restaurants editorial lists (Time Out has no self-serve API; content is licensed case-by-case). One city page per run.',
    // ONE page: a city restaurants hub. input.region = city slug, default tokyo.
    listUrl: (input) => `https://www.timeout.com/${input.region ?? 'tokyo'}/restaurants`,
    waitFor: 'a[href*="/restaurants/"]',
    consentSelectors: ['#onetrust-accept-btn-handler', 'button[id*="accept"]'],
    incremental: full(
      'One city editorial page per run; diff the article/venue set by content_hash. Production can use the sitemap <lastmod> for changed-page deltas under licence.',
    ),
    // Article/venue links: /<city>/restaurants/<slug> — use the full path-after-/restaurants/ as the stable id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/restaurants/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              const slug = a.href.match(/\/restaurants\/([^/?#]+)/)?.[1] ?? '';
              return {
                href: a.href,
                id: slug,
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              };
            })
            .filter((x) => x.id && x.id !== '' && x.name)
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id.slice(0, 80), name: x.name, url: x.href, raw: x })),
        limit,
      ),
  },
  {
    id: 'lonely-planet',
    displayName: 'Lonely Planet (web scrape)',
    tier: 'B',
    coverage: 'Global, EN; attractions / POIs editorial',
    access:
      'Public lonelyplanet.com/<place>/attractions listing pages (content is otherwise licensed via ArrivalGuides). One destination attractions page per run.',
    // ONE page: a destination attractions list. input.region = the geo path, default japan/kansai/kyoto.
    listUrl: (input) =>
      `https://www.lonelyplanet.com/${input.region ?? 'japan/kansai/kyoto'}/attractions`,
    waitFor: 'a[href*="/poi-sig/"], a[href*="/points-of-interest/"]',
    consentSelectors: ['#onetrust-accept-btn-handler', 'button[id*="accept"]'],
    incremental: full(
      'One destination attractions page per run; diff the POI set by content_hash. Lonely Planet has no public updated_since on the web list.',
    ),
    note: 'Attraction cards render client-side — keep the waitFor on the POI anchors; if 0 items, the list hydrated late, increase dwell.',
    // POI links: .../a/poi-sig/<id>/<extra> OR /points-of-interest/<slug>/<id> — capture the numeric id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/poi-sig/"], a[href*="/points-of-interest/"]',
        (els, max) => {
          const seen = new Set<string>();
          return els
            .map((e) => {
              const a = e as unknown as { href: string; textContent: string | null };
              const id =
                a.href.match(/\/poi-sig\/(\d+)/)?.[1] ??
                a.href.match(/\/points-of-interest\/[^/]+\/(\d+)/)?.[1] ??
                '';
              return {
                href: a.href,
                id,
                name: (a.textContent ?? '').trim().replace(/\s+/g, ' '),
              };
            })
            .filter((x) => {
              if (!x.id || seen.has(x.id)) return false;
              seen.add(x.id);
              return true;
            })
            .slice(0, max as number)
            .map((x) => ({ sourceId: x.id, name: x.name || undefined, url: x.href, raw: x }));
        },
        limit,
      ),
  },
];
