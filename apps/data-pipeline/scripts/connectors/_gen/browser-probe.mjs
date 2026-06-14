/**
 * Doability probe: can system Chrome (Playwright) reach real target sites and see
 * content, or do they wall us (Cloudflare/DataDome/JS)? Tries headless first,
 * then headed for any site that looks challenged. Reports per site:
 *   status code, title, body length, challenge?, and a rough "result element" count.
 *
 * Usage: node _gen/browser-probe.mjs
 */
import { chromium } from 'playwright';

const TARGETS = [
  { id: 'google-maps', url: 'https://www.google.com/maps/search/restaurants+in+George+Town+Penang', sel: 'div[role="feed"] a[href*="/maps/place/"]' },
  { id: 'yelp', url: 'https://www.yelp.com/search?find_desc=restaurants&find_loc=San+Francisco,+CA', sel: '[data-testid="serp-ia-card"], div[class*="businessName"]' },
  { id: 'tripadvisor', url: 'https://www.tripadvisor.com/Restaurants-g298303-Penang.html', sel: 'div[data-test*="list_item"], a[href*="/Restaurant_Review"]' },
  { id: 'tabelog', url: 'https://tabelog.com/en/kanagawa/', sel: 'a.list-rst__rst-name-target, .list-rst__rst-name' },
  { id: 'atlas-obscura', url: 'https://www.atlasobscura.com/places', sel: 'a[href*="/places/"]' },
  { id: '2gis', url: 'https://2gis.ru/moscow/search/кафе', sel: 'a[href*="/firm/"]' },
  { id: 'wongnai', url: 'https://www.wongnai.com/restaurants', sel: 'a[href*="/restaurants/"]' },
];

function detectChallenge(title, body) {
  const t = (title || '').toLowerCase();
  const b = (body || '').slice(0, 2000).toLowerCase();
  if (t.includes('just a moment') || b.includes('cf-chl') || b.includes('challenges.cloudflare')) return 'cloudflare';
  if (b.includes('datadome')) return 'datadome';
  if (b.includes('px-captcha') || b.includes('perimeterx')) return 'perimeterx';
  if (t.includes('access denied') || t.includes('attention required')) return 'waf';
  return null;
}

async function probe(headless) {
  const browser = await chromium.launch({ headless, channel: 'chrome' });
  const ctx = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 900 },
    locale: 'en-US',
  });
  const results = [];
  for (const t of TARGETS) {
    const page = await ctx.newPage();
    let status = 0, title = '', bodyLen = 0, count = 0, challenge = null, err = null;
    try {
      const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp?.status() ?? 0;
      await page.waitForTimeout(3500); // let JS render
      title = await page.title();
      const body = await page.evaluate(() => document.body?.innerText ?? '');
      bodyLen = body.length;
      challenge = detectChallenge(title, await page.content());
      if (!challenge) {
        count = await page.$$eval(t.sel, (els) => els.length).catch(() => 0);
      }
    } catch (e) {
      err = e.message.split('\n')[0];
    } finally {
      await page.close();
    }
    results.push({ id: t.id, mode: headless ? 'headless' : 'headed', status, title: title.slice(0, 40), bodyLen, count, challenge, err });
  }
  await browser.close();
  return results;
}

function row(r) {
  return `${r.id.padEnd(14)} ${r.mode.padEnd(9)} http:${String(r.status).padEnd(4)} body:${String(r.bodyLen).padEnd(7)} hits:${String(r.count).padEnd(4)} ${r.challenge ? 'CHALLENGE:' + r.challenge : r.err ? 'ERR:' + r.err.slice(0, 30) : 'OK'}`;
}

const headless = await probe(true);
console.log('\n=== HEADLESS ===');
for (const r of headless) console.log(row(r));

// Retry the challenged/empty ones headed.
const retry = headless.filter((r) => r.challenge || r.bodyLen < 500 || r.count === 0).map((r) => r.id);
if (retry.length) {
  console.log(`\n=== HEADED retry for: ${retry.join(', ')} ===`);
  // Temporarily narrow TARGETS via closure isn't trivial; just rerun all headed.
  const headed = await probe(false);
  for (const r of headed) if (retry.includes(r.id)) console.log(row(r));
}
console.log('\ndone.');
