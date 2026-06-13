/**
 * Browser-scrape strategies — CLUSTER: asia-community.
 *
 * Asian food/dining community platforms (India, SG/MY, Vietnam, Indonesia, Korea, SEA).
 * Each connector visits exactly ONE public listing/search page per run, like a normal
 * user — no pagination, no multi-page crawl. The framework adds human dwell/scroll +
 * pacing + challenge detection; extractors here only map the result elements on that one
 * page to stable {sourceId,name,url} items via page.$$eval.
 *
 * Live-verified (2026-06) listing URLs + selectors:
 *   - server-rendered anchors (work with plain Chrome): magicpin, burpple,
 *     hungrygowhere, foody-shopeefood, qraved
 *   - JS/SPA — cards render after a wait: swiggy-dineout, eatigo, diningcode
 *   - enterprise WAF (HTTP 403 from datacenter IP, needs proxy/unblocker): zomato,
 *     and likely swiggy/diningcode under load
 *
 * Stable sourceId is the site's own id/slug pulled from the href:
 *   magicpin /store/<id>/ · burpple/foody/qraved last path slug · hungrygowhere
 *   <category>/<slug> · eatigo /branches/<id> · diningcode rid=<id> · zomato city/slug.
 */
import { type BrowserStrategy } from '../core/browser-connector.js';
import type { Page } from 'playwright';

const full = (desc: string) => ({ method: 'full-only' as const, supported: true, description: desc });

export const browserAsiaCommunity: BrowserStrategy[] = [
  {
    id: 'zomato',
    displayName: 'Zomato (web scrape)',
    tier: 'E',
    coverage: 'India + global; restaurant listings, ratings, reviews, menus',
    access:
      'Public zomato.com city restaurant listing (the legacy content API was discontinued ~2022; only a merchant POS API remains).',
    listUrl: (input) =>
      `https://www.zomato.com/${encodeURIComponent(input.region ?? 'penang')}/restaurants`,
    waitFor: 'a[href*="/restaurants/"], a[href*="/info"]',
    incremental: full(
      'No web sort-by-new; one city listing page per run, diff the restaurant set by content_hash. No public since-param.',
    ),
    note: 'Anti-bot wall (HTTP 403 from a datacenter IP, DataDome-style): needs BROWSER_PROXY (residential/unblocker). The framework detects the challenge at runtime.',
    // Zomato restaurant anchors carry the name as link text; id = the city/slug path.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/restaurants/"], a[href*="zomato.com/"][href*="/info"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const path = a.href.replace(/^https?:\/\/[^/]+/, '').replace(/[?#].*$/, '');
              const slug = path.replace(/\/restaurants\//, '/').replace(/\/info\/?$/, '').replace(/^\/+|\/+$/g, '');
              return { sourceId: (slug || a.href).slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href } };
            })
            .filter((x) => x.name && x.sourceId)
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'swiggy-dineout',
    displayName: 'Swiggy Dineout (web scrape)',
    tier: 'E',
    coverage: 'India; dine-in restaurant offers, ratings, cuisines',
    access:
      'Public swiggy.com/dineout city page (Swiggy exposes only partner/POS integrations, no public read API).',
    listUrl: (input) =>
      `https://www.swiggy.com/dineout/${encodeURIComponent(input.region ?? 'bangalore')}`,
    waitFor: 'a[href*="/dineout/restaurants/"]',
    incremental: full(
      'SPA renders restaurant cards client-side after location is set; one page per run, diff by content_hash. No since-param.',
    ),
    note: 'SPA — restaurant cards render late (and may require a precise-location prompt); if 0 items, increase the wait or target the result container. Anti-bot is likely from a datacenter IP: set BROWSER_PROXY if challenged.',
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/dineout/restaurants/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              // /dineout/restaurants/<slug>/<id> — keep the trailing numeric/uuid id where present.
              const m = a.href.match(/\/dineout\/restaurants\/([^/?#]+(?:\/[^/?#]+)?)/);
              return { sourceId: (m?.[1] ?? a.href).slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href } };
            })
            .filter((x) => x.sourceId)
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'magicpin',
    displayName: 'magicpin (web scrape)',
    tier: 'E',
    coverage: 'India; local restaurant/store listings, deals, ratings',
    access: 'Public magicpin.in city restaurant listing (no public content API; ToS-light fingerprint is sitemap-lastmod).',
    listUrl: (input) =>
      `https://magicpin.in/${encodeURIComponent(input.region ?? 'New-Delhi')}/Restaurant/`,
    waitFor: 'a[href*="/store/"]',
    incremental: full(
      'One city listing page per run; diff the store set by content_hash. Sitemap <lastmod> exists separately for a cheaper delta, but we visit only this one page.',
    ),
    note: 'Anti-bot is possible from a datacenter IP: set BROWSER_PROXY if challenged.',
    // Store URL: /<city>/<area>/Restaurant/<name>/store/<id>/ — stable id is the /store/<id>/ segment.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/store/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { sourceId: (a.href.match(/\/store\/([^/?#]+)/)?.[1] ?? a.href).slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href } };
            })
            .filter((x) => x.name && x.sourceId)
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'burpple',
    displayName: 'Burpple (web scrape)',
    tier: 'E',
    coverage: 'Singapore + Malaysia; venue reviews, photos, Beyond deals',
    access: 'Public burpple.com search results (no sanctioned API; listings use dynamic load-more).',
    listUrl: (input) =>
      `https://www.burpple.com/search/${encodeURIComponent(input.region ?? 'sg')}`,
    waitFor: 'a[href*="?bp_ref="]',
    incremental: full(
      'One search page per run; diff the venue set by content_hash. No since-param; sitemap-lastmod is the separate cheaper signal.',
    ),
    // Venue links are bare anchors /<venue-slug>?bp_ref=... — slug is the stable id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="?bp_ref="]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const slug = a.href.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
              return { sourceId: slug.slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href } };
            })
            .filter((x) => x.sourceId && !x.sourceId.includes('/') && x.name)
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'hungrygowhere',
    displayName: 'HungryGoWhere (web scrape)',
    tier: 'E',
    coverage: 'Singapore; dining guides, critics reviews, food news (Grab)',
    access: 'Public hungrygowhere.com dining guides index (WordPress; no public content API).',
    listUrl: () => 'https://hungrygowhere.com/dining-guides/',
    waitFor: 'a[href*="hungrygowhere.com/"]',
    incremental: full(
      'One index page per run; diff the article/guide set by content_hash. Sitemap <lastmod> is the separate cheaper delta.',
    ),
    // Article URLs: /<category>/<slug>/ — stable id is the <category>/<slug> path.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="hungrygowhere.com/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const path = a.href.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
              return { sourceId: path.slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href, path } };
            })
            // keep two-segment <category>/<slug> article paths; drop nav/home/single-segment.
            .filter((x) => x.name && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(x.sourceId))
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'foody-shopeefood',
    displayName: 'Foody / ShopeeFood (web scrape)',
    tier: 'E',
    coverage: 'Vietnam; place listings, reviews, photos',
    access: 'Public foody.vn city place listing (no open content API; private app endpoints sit behind anti-bot).',
    listUrl: (input) =>
      `https://www.foody.vn/${encodeURIComponent(input.region ?? 'ha-noi')}/dia-diem`,
    waitFor: 'a[href*="foody.vn/"]',
    incremental: full(
      'One city place-listing page per run; diff the place set by content_hash. No public since-param.',
    ),
    note: 'Anti-bot is possible from a datacenter IP: set BROWSER_PROXY if challenged.',
    // Place URLs: /<city>/<place-slug> — stable id is the <city>/<slug> path.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="foody.vn/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const path = a.href.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
              return { sourceId: path.slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href, path } };
            })
            // keep two-segment <city>/<slug> place paths; drop nav/category single-segment links.
            .filter((x) => x.name && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(x.sourceId))
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'eatigo',
    displayName: 'Eatigo (web scrape)',
    tier: 'E',
    coverage: 'SE Asia (SG/TH/MY/etc.); time-based restaurant reservation deals',
    access: 'Public eatigo.com region listing (reservation platform; no public content API). region 27 = Singapore.',
    listUrl: (input) =>
      `https://eatigo.com/en/regions/${encodeURIComponent(input.region ?? '27')}`,
    waitFor: 'a[href*="/branches/"]',
    incremental: full(
      'One region page per run; restaurant cards render via JS, then diff the branch set by content_hash. No since-param.',
    ),
    note: 'Cards render client-side after the region page loads; if 0 items, increase the wait. Set BROWSER_PROXY if challenged from a datacenter IP.',
    // Branch URLs: /en/branches/<numeric-id> — id is stable.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/branches/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { sourceId: (a.href.match(/\/branches\/(\d+)/)?.[1] ?? a.href).slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href } };
            })
            .filter((x) => x.sourceId)
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'qraved',
    displayName: 'Qraved (web scrape)',
    tier: 'E',
    coverage: 'Indonesia; restaurant listings, reviews, photos',
    access: 'Public qraved.com city restaurant listing (no public content API).',
    listUrl: (input) =>
      `https://www.qraved.com/${encodeURIComponent(input.region ?? 'jakarta')}/restaurants`,
    waitFor: 'a[href^="/jakarta/"], a[href*="qraved.com/jakarta/"]',
    incremental: full(
      'One city listing page per run; diff the restaurant set by content_hash. No since-param.',
    ),
    // Restaurant URLs: /<city>/<restaurant-slug> — stable id is the <city>/<slug> path.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="/jakarta/"]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              const path = a.href.replace(/^https?:\/\/[^/]+\//, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
              return { sourceId: path.slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href, path } };
            })
            // keep two-segment <city>/<slug> restaurant paths; drop section links.
            .filter((x) => x.name && /^[a-z0-9-]+\/[a-z0-9-]+$/.test(x.sourceId))
            .slice(0, max as number),
        limit,
      ),
  },
  {
    id: 'diningcode',
    displayName: 'DiningCode (web scrape)',
    tier: 'E',
    coverage: 'South Korea; 다이닝코드 ranked restaurant lists, reviews',
    access: 'Public diningcode.com keyword list page (no public content API; aggregated Korean DB).',
    listUrl: (input) =>
      `https://www.diningcode.com/list.dc?query=${encodeURIComponent(input.region ?? '서울')}`,
    waitFor: 'a[href*="profile.php?rid="]',
    incremental: full(
      'One ranked-list page per run; results render via JS, then diff the rid set by content_hash. No since-param.',
    ),
    note: 'List renders client-side (the raw HTML is mostly an empty shell); if 0 items, increase the wait. Anti-bot is likely from a datacenter IP: set BROWSER_PROXY if challenged.',
    // Detail URLs: /profile.php?rid=<id> — rid is the stable id.
    extract: (page, limit) =>
      page.$$eval(
        'a[href*="profile.php?rid="]',
        (els, max) =>
          els
            .map((e) => {
              const a = e as HTMLAnchorElement;
              return { sourceId: (a.href.match(/[?&]rid=([^&#]+)/)?.[1] ?? a.href).slice(0, 80), name: (a.textContent ?? '').trim().replace(/\s+/g, ' '), url: a.href, raw: { href: a.href } };
            })
            .filter((x) => x.sourceId)
            .slice(0, max as number),
        limit,
      ),
  },
];
