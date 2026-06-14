/**
 * Diagnose the browser strategies that reached a page but extracted 0 items.
 * Loads each strategy's listUrl in Chrome (human-like), then dumps the real DOM
 * structure so we can fix the selector:
 *   final URL (redirects), title, body length, challenge?, iframe srcs,
 *   and the top anchor href path-prefixes with counts.
 *
 * Run: npx tsx scripts/connectors/_gen/diagnose-zero.ts
 */
import { launchChrome } from '../core/browser.js';
import { looksLikeChallenge } from '../core/fingerprint.js';
import { starterStrategies } from '../browser/starter.js';
import { browserMapsApis } from '../browser/maps-apis.js';
import { browserLicensable } from '../browser/licensable.js';
import { browserOta } from '../browser/ota.js';
import { browserCnKr } from '../browser/cn-kr.js';
import { browserAsiaCommunity } from '../browser/asia-community.js';
import { browserGlobalCommunity } from '../browser/global-community.js';
import { browserRussiaMena } from '../browser/russia-mena.js';
import type { BrowserStrategy } from '../core/browser-connector.js';

const ALL: BrowserStrategy[] = [
  ...starterStrategies, ...browserMapsApis, ...browserLicensable, ...browserOta,
  ...browserCnKr, ...browserAsiaCommunity, ...browserGlobalCommunity, ...browserRussiaMena,
];
const byId = new Map(ALL.map((s) => [s.id, s]));

const TARGETS = [
  '2gis', 'amap', 'naver-map', 'booking-com', 'opentable', 'trip-com', 'meituan',
  'mafengwo', 'ctrip', 'qunar', 'tongcheng', 'yeogi-goodchoice', 'catchtable', 'qyer',
  'zomato', 'swiggy-dineout', 'culture-trip', 'foursquare', 'yandex-eda', 'reddit', 'siksin',
];

const browser = await launchChrome({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 }, locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
});
await ctx.addInitScript(`Object.defineProperty(navigator,'webdriver',{get:()=>undefined});window.chrome={runtime:{}};`);

for (const id of TARGETS) {
  const s = byId.get(id);
  if (!s) { console.log(`\n## ${id}: NOT FOUND`); continue; }
  const url = s.listUrl({});
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(4000); // let SPA render
    await page.evaluate(() => window.scrollBy({ top: 1600 })).catch(() => {});
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`\n## ${id}\nurl: ${url}\nGOTO ERROR: ${(e as Error).message.split('\n')[0]}`);
    await page.close();
    continue;
  }
  const info = await page.evaluate(() => {
    const counts: Record<string, number> = {};
    for (const a of Array.from(document.querySelectorAll('a[href]'))) {
      try {
        const u = new URL((a as HTMLAnchorElement).href, location.href);
        if (u.hostname && !u.hostname.includes(location.hostname.split('.').slice(-2).join('.'))) continue;
        const seg = u.pathname.split('/').filter(Boolean).slice(0, 2).join('/');
        const key = '/' + seg;
        counts[key] = (counts[key] || 0) + 1;
      } catch { /* skip */ }
    }
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12);
    const iframes = Array.from(document.querySelectorAll('iframe')).map((f) => (f as HTMLIFrameElement).src).filter(Boolean).slice(0, 4);
    return {
      finalUrl: location.href, title: document.title,
      bodyLen: document.body?.innerText?.length ?? 0,
      topAnchors: top, iframes,
    };
  });
  const challenge = looksLikeChallenge(status, `${info.title}\n${await page.content().catch(() => '')}`);
  console.log(`\n## ${id}  [http ${status}${challenge ? ' CHALLENGE:' + challenge : ''}]`);
  console.log(`url:   ${url}`);
  if (info.finalUrl !== url) console.log(`final: ${info.finalUrl}`);
  console.log(`title: ${info.title.slice(0, 70)} | bodyLen: ${info.bodyLen}`);
  if (info.iframes.length) console.log(`iframes: ${info.iframes.join(' | ')}`);
  console.log(`top anchors: ${info.topAnchors.map(([k, n]) => `${k}(${n})`).join('  ')}`);
  await page.close();
}
await browser.close();
console.log('\ndone.');
