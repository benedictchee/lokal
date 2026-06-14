/**
 * Playwright/Chrome helper for sources with no API (or where we scrape the public
 * site instead of a key/licence-gated API). Uses the system Chrome via
 * `channel: 'chrome'` (the bundled headless shell isn't installed here).
 *
 * Browser runs are GATED behind PROBE_BROWSER=1 so a bulk `all` run doesn't spin
 * up Chrome for every connector. Set PROBE_BROWSER=1 to enable.
 *
 * Doability (measured 2026-06): plain headless Chrome scrapes most sites that
 * merely JS-render (Google Maps, Tabelog, Wongnai, …). Enterprise bot-management
 * (DataDome: Yelp/TripAdvisor; Cloudflare-managed: Atlas Obscura/AllTrails) blocks
 * at the TLS/IP edge from a datacenter IP — those need a residential proxy /
 * unblocker, pluggable here via BROWSER_PROXY (and, optionally, a stealth stack).
 */
import type { Browser, Page } from 'playwright';
import { looksLikeChallenge } from './fingerprint.js';

export function browserEnabled(env: Record<string, string | undefined>): boolean {
  return env.PROBE_BROWSER === '1' || env.PROBE_BROWSER === 'true';
}

const STEALTH_INIT = `
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
Object.defineProperty(navigator, 'languages', { get: () => ['en-US','en'] });
Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
window.chrome = { runtime: {} };
`;

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export interface LaunchOpts {
  headless?: boolean;
  /** Residential proxy / unblocker endpoint, e.g. http://user:pass@host:port (env BROWSER_PROXY). */
  proxy?: string;
  locale?: string;
  timezoneId?: string;
}

/** Launch system Chrome with passive anti-detection + optional proxy. */
export async function launchChrome(opts: LaunchOpts = {}): Promise<Browser> {
  const { chromium } = await import('playwright');
  return chromium.launch({
    headless: opts.headless ?? true,
    channel: 'chrome',
    proxy: opts.proxy ? { server: opts.proxy } : undefined,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'],
  });
}

/** Run `fn` against a fresh stealth page; closes everything after. */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  opts: LaunchOpts & { timeoutMs?: number } = {},
): Promise<T> {
  const browser = await launchChrome(opts);
  try {
    const ctx = await browser.newContext({
      userAgent: DEFAULT_UA,
      viewport: { width: 1440, height: 900 },
      locale: opts.locale ?? 'en-US',
      timezoneId: opts.timezoneId,
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    });
    await ctx.addInitScript(STEALTH_INIT);
    const page = await ctx.newPage();
    page.setDefaultTimeout(opts.timeoutMs ?? 25_000);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

export interface ScrapeOutcome<T> {
  items: T[];
  challenge: string | null;
  status: number;
  bodyLen: number;
  title: string;
}

/** Human-ish jittered delay. */
function jitter(min: number, max: number): Promise<void> {
  // Deterministic-ish randomness is unnecessary here; spread requests humanly.
  const ms = Math.floor(min + Math.random() * (max - min));
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Behave like a person reading ONE page: a couple of unhurried, easing scrolls
 * with small mouse moves and pauses. No pagination, no rapid loops. This both
 * looks natural and triggers lazy-loaded content on a single page view.
 */
async function humanDwell(page: Page): Promise<void> {
  await jitter(700, 1600); // glance at the page
  const steps = 3 + Math.floor(Math.random() * 3); // 3–5 gentle scrolls
  for (let i = 0; i < steps; i++) {
    const dy = 350 + Math.floor(Math.random() * 500);
    await page.mouse.move(200 + Math.random() * 900, 200 + Math.random() * 500).catch(() => {});
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy).catch(() => {});
    await jitter(600, 1500);
  }
}

/**
 * Navigate to `url` ONCE (one page, one visit per source per run), dismiss a
 * consent banner if present, browse like a human, detect hard WAF walls, then run
 * the page-side `extract`. Never throws. Deliberately does NOT paginate or open
 * further pages — keep robotic multi-page crawling out of the prototype.
 */
export async function scrapePage<T>(
  url: string,
  extract: (page: Page) => Promise<T[]>,
  opts: LaunchOpts & { timeoutMs?: number; consentSelectors?: string[]; waitFor?: string } = {},
): Promise<ScrapeOutcome<T>> {
  return withPage(async (page) => {
    let status = 0;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs ?? 25_000 });
      status = resp?.status() ?? 0;
    } catch {
      /* continue — some sites abort the main frame but still render */
    }
    // Quick challenge check right after load (cheap signal before we invest time).
    const earlyTitle = await page.title().catch(() => '');
    let challenge = looksLikeChallenge(status, `${earlyTitle}\n${await page.content().catch(() => '')}`);
    if (challenge) {
      return { items: [], challenge, status, bodyLen: 0, title: earlyTitle };
    }
    // Dismiss a consent/cookie wall like a person would (one click, if visible).
    for (const sel of opts.consentSelectors ?? [
      'button:has-text("Accept")',
      'button:has-text("I agree")',
      'button:has-text("Accept all")',
      '[aria-label*="Accept"]',
    ]) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 800 })) {
          await jitter(300, 900);
          await btn.click({ timeout: 1500 });
          break;
        }
      } catch {
        /* none */
      }
    }
    if (opts.waitFor) await page.waitForSelector(opts.waitFor, { timeout: 8000 }).catch(() => {});
    await humanDwell(page); // read the single page naturally
    const title = await page.title().catch(() => earlyTitle);
    const bodyLen = (await page.evaluate(() => document.body?.innerText?.length ?? 0).catch(() => 0)) as number;
    challenge = looksLikeChallenge(status, `${title}\n${await page.content().catch(() => '')}`);
    if (challenge) return { items: [], challenge, status, bodyLen, title };
    const items = await extract(page).catch(() => [] as T[]);
    return { items, challenge: null, status, bodyLen, title };
  }, opts);
}
