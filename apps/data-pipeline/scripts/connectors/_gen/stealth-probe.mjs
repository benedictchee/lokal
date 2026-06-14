/**
 * Stealth probe: can passive evasions get system Chrome past DataDome (Yelp,
 * TripAdvisor) and Cloudflare (Atlas Obscura)? Techniques:
 *  - launch arg --disable-blink-features=AutomationControlled
 *  - addInitScript removing navigator.webdriver + faking plugins/languages/chrome
 *  - realistic UA / Accept-Language / timezone / viewport
 *  - wait out Cloudflare's non-interactive challenge (title flips from "Just a moment")
 * Tries headless then headed.
 */
import { chromium } from 'playwright';

const TARGETS = [
  { id: 'yelp', url: 'https://www.yelp.com/search?find_desc=restaurants&find_loc=San+Francisco,+CA' },
  { id: 'tripadvisor', url: 'https://www.tripadvisor.com/Restaurants-g298303-Penang.html' },
  { id: 'atlas-obscura', url: 'https://www.atlasobscura.com/places' },
];

const STEALTH = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
window.chrome = { runtime: {} };
const origQuery = window.navigator.permissions && window.navigator.permissions.query;
if (origQuery) window.navigator.permissions.query = (p) => p && p.name === 'notifications'
  ? Promise.resolve({ state: Notification.permission }) : origQuery(p);
`;

function detect(title, body) {
  const t = (title || '').toLowerCase(), b = (body || '').slice(0, 2000).toLowerCase();
  if (t.includes('just a moment') || b.includes('cf-chl')) return 'cloudflare';
  if (b.includes('datadome')) return 'datadome';
  if (t.includes('access') || t.includes('attention required') || t.includes('blocked')) return 'waf';
  return null;
}

async function run(headless) {
  const browser = await chromium.launch({
    headless,
    channel: 'chrome',
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-features=IsolateOrigins,site-per-process'],
  });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  await ctx.addInitScript(STEALTH);
  const out = [];
  for (const t of TARGETS) {
    const page = await ctx.newPage();
    let status = 0, title = '', bodyLen = 0, challenge = null, err = null, waited = 0;
    try {
      const resp = await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      status = resp?.status() ?? 0;
      // Wait out a Cloudflare non-interactive challenge: poll title up to ~15s.
      for (let i = 0; i < 8; i++) {
        title = await page.title();
        const body = await page.evaluate(() => document.body?.innerText ?? '');
        bodyLen = body.length;
        challenge = detect(title, await page.content());
        if (!challenge && bodyLen > 800) break;
        await page.waitForTimeout(2000);
        waited += 2;
      }
    } catch (e) {
      err = e.message.split('\n')[0];
    } finally {
      await page.close();
    }
    out.push({ id: t.id, mode: headless ? 'headless' : 'headed', status, bodyLen, waited, challenge, err, title: title.slice(0, 30) });
  }
  await browser.close();
  return out;
}

const fmt = (r) => `${r.id.padEnd(14)} ${r.mode.padEnd(9)} http:${String(r.status).padEnd(4)} body:${String(r.bodyLen).padEnd(7)} waited:${r.waited}s ${r.challenge ? 'CHALLENGE:' + r.challenge : r.err ? 'ERR:' + r.err.slice(0, 30) : 'PASSED ✓'}`;

console.log('=== STEALTH headless ===');
for (const r of await run(true)) console.log(fmt(r));
console.log('\n=== STEALTH headed ===');
for (const r of await run(false)) console.log(fmt(r));
console.log('\ndone.');
