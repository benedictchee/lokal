/**
 * M4 — Google Maps reviews scraper (Playwright + system Chrome, headed).
 *
 * Usage:
 *   pnpm --filter @travel/data-pipeline scrape:google
 *   pnpm exec tsx scripts/scrape-google.ts [--normalize]
 *
 * Writes raw JSON to scripts/out/google-georgetown.json (gitignored).
 * With --normalize: also runs googlePlaceToRecord over the output and prints a
 * summary of the normalized records, confirming reviews survive into attributes.
 */

import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { googlePlaceToRecord } from '@travel/pipeline-core';
import type { GoogleRawPlace, GoogleRawOutput } from '@travel/pipeline-core';

// ---------------------------------------------------------------------------
// CONFIG
// ---------------------------------------------------------------------------

const QUERY = 'restaurants in George Town Penang';
const MAX_PLACES = 10; // cap for the MVP
const MAX_REVIEWS_PER_PLACE = 5;
const SCROLL_ITER_CAP = 10; // max scroll iterations per container
const MIN_DELAY_MS = 1500;
const MAX_DELAY_MS = 4000;

// Output
const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const OUT_FILE = join(OUT_DIR, 'google-georgetown.json');

// ---------------------------------------------------------------------------
// SELECTORS — centralised. Google rotates class names; update here first.
// Prefer aria-label / role anchors where possible.
// ---------------------------------------------------------------------------
const SEL = {
  // Feed on the search results page
  feed: 'div[role="feed"]',
  card: 'div.Nv2PK',
  cardLink: 'a.hfpxzc',
  cardName: '.qBF1Pd',
  cardRating: 'span.MW4etd',
  cardReviewCount: 'span.UY7F9',

  // Place detail panel
  placeHeading: 'h1',
  placeCategory: 'button[jsaction*="category"]',
  placeRating: 'div.F7nice span[aria-hidden="true"]',
  placeReviewCount: 'div.F7nice span[aria-label*="reviews"]',

  // Reviews tab (try aria-label anchors first)
  reviewsTabRole: 'button[role="tab"][aria-label*="Reviews"]',

  // Review container
  reviewsContainer: 'div.m6QErb[role="region"]',
  reviewNode: 'div.jftiEf',
  reviewAuthor: '.d4r55',
  reviewStars: 'span.kvMYJc[aria-label]',
  reviewDate: 'span.rsqaWe',
  reviewText: '.wiI7pd',
  reviewMoreBtn: 'button.w8nwRe',
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function randomDelay(min = MIN_DELAY_MS, max = MAX_DELAY_MS): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((r) => setTimeout(r, ms));
}

/** Parse lat/lng from a Google Maps href. */
function parseCoordsFromHref(href: string): { lat: number; lng: number } | null {
  const m = href.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  if (!m || !m[1] || !m[2]) return null;
  return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
}

/** Parse ftid (0x...:0x...) from href. */
function parseFtidFromHref(href: string): string {
  const m = href.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  return m?.[1] ?? '';
}

/** Parse place_id (ChIJ...) from href — tries !19s and !16s segments. */
function parsePlaceIdFromHref(href: string): string {
  // !19s prefixed
  const m19 = href.match(/!19s(ChIJ[^!&?]+)/);
  if (m19?.[1]) return decodeURIComponent(m19[1]);
  // !16s prefixed
  const m16 = href.match(/!16s(ChIJ[^!&?%]+)/);
  if (m16?.[1]) return decodeURIComponent(m16[1]);
  // Bare ChIJ in URL
  const mBare = href.match(/\/(ChIJ[A-Za-z0-9_-]+)/);
  if (mBare?.[1]) return mBare[1];
  return '';
}

/** Parse star count from aria-label like "5 stars" or "4 stars". */
function parseStarsFromAriaLabel(label: string | null): number | null {
  if (!label) return null;
  const m = label.match(/^(\d)/);
  return m?.[1] ? parseInt(m[1], 10) : null;
}

// ---------------------------------------------------------------------------
// SCROLL HELPER
// ---------------------------------------------------------------------------

/** Scroll a container element until `countFn` returns >= target or no growth. */
async function scrollUntil(
  page: import('playwright').Page,
  containerSelector: string,
  target: number,
  iterCap: number,
  countSelector: string,
): Promise<void> {
  let prev = 0;
  for (let i = 0; i < iterCap; i++) {
    const count = await page.locator(containerSelector).locator(countSelector).count();
    if (count >= target) break;
    if (i > 0 && count === prev) break; // no growth
    prev = count;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.locator(containerSelector).evaluate((el: Element) => {
      (el as unknown as { scrollTop: number }).scrollTop += 800;
    });
    await randomDelay(800, 1400);
  }
}

// ---------------------------------------------------------------------------
// SCRAPE REVIEWS FOR ONE PLACE
// ---------------------------------------------------------------------------

async function scrapeReviews(
  page: import('playwright').Page,
  placeHref: string,
): Promise<{
  name: string;
  category: string;
  rating: number | null;
  review_count: number | null;
  reviews: GoogleRawPlace['reviews'];
}> {
  // Navigate with hl=en
  const url = placeHref.includes('?') ? `${placeHref}&hl=en` : `${placeHref}?hl=en`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for h1
  await page.waitForSelector(SEL.placeHeading, { timeout: 15000 }).catch(() => null);

  // Grab panel data
  const name = await page.locator(SEL.placeHeading).first().textContent() ?? '';
  const category =
    (await page.locator(SEL.placeCategory).first().textContent().catch(() => null)) ?? '';
  const ratingText =
    (await page.locator(SEL.placeRating).first().textContent().catch(() => null)) ?? '';
  const reviewCountText =
    (await page
      .locator(SEL.placeReviewCount)
      .first()
      .getAttribute('aria-label')
      .catch(() => null)) ?? '';

  const rating = ratingText ? parseFloat(ratingText) : null;
  const reviewCountMatch = reviewCountText.match(/[\d,]+/);
  const review_count = reviewCountMatch
    ? parseInt(reviewCountMatch[0].replace(/,/g, ''), 10)
    : null;

  // Click the Reviews tab
  let reviewsTabFound = false;
  try {
    const tab = page.locator(SEL.reviewsTabRole).first();
    const tabCount = await tab.count();
    if (tabCount > 0) {
      await tab.click();
      reviewsTabFound = true;
    }
  } catch (_) {
    // try XPath fallback
  }

  if (!reviewsTabFound) {
    // XPath fallback
    try {
      await page.locator('//button[contains(@aria-label,"Reviews")]').first().click();
      reviewsTabFound = true;
    } catch (_) {
      console.log(`  [warn] Could not find Reviews tab for "${name.trim()}"`);
    }
  }

  await randomDelay(1000, 2000);

  // Check if reviews container exists
  const hasContainer = (await page.locator(SEL.reviewsContainer).count()) > 0;
  if (!hasContainer) {
    // Some places have reviews directly in the panel without a separate tab
    const directNodes = await page.locator(SEL.reviewNode).count();
    if (directNodes === 0) {
      console.log(`  [warn] No reviews container found for "${name.trim()}"`);
    }
  }

  // Scroll reviews container to load more
  if (hasContainer) {
    await scrollUntil(page, SEL.reviewsContainer, MAX_REVIEWS_PER_PLACE, SCROLL_ITER_CAP, SEL.reviewNode);
  }

  // Extract review nodes
  const reviewNodes = page.locator(SEL.reviewNode);
  const reviewCount = await reviewNodes.count();
  if (reviewCount === 0) {
    console.log(`  [warn] Selector "${SEL.reviewNode}" found 0 review nodes for "${name.trim()}"`);
  }

  const reviews: GoogleRawPlace['reviews'] = [];
  const limit = Math.min(reviewCount, MAX_REVIEWS_PER_PLACE);

  for (let i = 0; i < limit; i++) {
    const node = reviewNodes.nth(i);

    // Expand "More" button if present
    const moreBtn = node.locator(SEL.reviewMoreBtn);
    if ((await moreBtn.count()) > 0) {
      await moreBtn.click().catch(() => null);
      await randomDelay(300, 600);
    }

    const author = (await node.locator(SEL.reviewAuthor).first().textContent().catch(() => null)) ?? '';
    const starsLabel = await node
      .locator(SEL.reviewStars)
      .first()
      .getAttribute('aria-label')
      .catch(() => null);
    const date = (await node.locator(SEL.reviewDate).first().textContent().catch(() => null)) ?? '';
    const text = (await node.locator(SEL.reviewText).first().textContent().catch(() => null)) ?? '';

    reviews.push({
      author: author.trim(),
      stars: parseStarsFromAriaLabel(starsLabel),
      date: date.trim(),
      text: text.trim(),
    });
  }

  return {
    name: name.trim(),
    category: category.trim(),
    rating: isFinite(rating as number) ? (rating as number) : null,
    review_count,
    reviews,
  };
}

// ---------------------------------------------------------------------------
// MAIN
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const normalizeMode = args.includes('--normalize');

  // If --normalize only, skip scraping and just normalize existing output
  if (normalizeMode && existsSync(OUT_FILE)) {
    console.log('\n[normalize] Running normalizer over existing raw output...\n');
    runNormalize();
    return;
  }

  console.log(`\nM4 Google Maps scraper — George Town, Penang`);
  console.log(`Query: "${QUERY}"`);
  console.log(`Max places: ${MAX_PLACES}, max reviews/place: ${MAX_REVIEWS_PER_PLACE}\n`);

  // Prefer system Chrome; fall back to bundled chromium
  const useSysChrome = existsSync('/Applications/Google Chrome.app');
  console.log(`Using ${useSysChrome ? 'system Chrome' : 'bundled Chromium'}...`);

  const browser = await chromium.launch({
    ...(useSysChrome ? { channel: 'chrome' } : {}),
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'en-US',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
    viewport: { width: 1280, height: 900 },
  });

  // Pre-accept consent wall
  await context.addCookies([
    { name: 'SOCS', value: 'CAESHAgBEhIaAB', domain: '.google.com', path: '/' },
    { name: 'CONSENT', value: 'YES+', domain: '.google.com', path: '/' },
  ]);

  const page = await context.newPage();

  const scraped_at = new Date().toISOString();
  const places: GoogleRawPlace[] = [];

  try {
    // 1. Load the search feed
    const searchUrl =
      'https://www.google.com/maps/search/' +
      encodeURIComponent(QUERY) +
      '/?hl=en';
    console.log(`Navigating to search feed: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Fallback: handle consent page
    await randomDelay(1500, 2500);
    const consentBtn = page.locator('button[aria-label*="Accept all"]');
    if ((await consentBtn.count()) > 0) {
      console.log('  [consent] Clicking "Accept all" consent button...');
      await consentBtn.first().click();
      await randomDelay(1500, 2500);
    } else {
      // Try generic consent form button
      const consentForm = page.locator('form[action*="consent"] button').last();
      if ((await consentForm.count()) > 0) {
        console.log('  [consent] Clicking consent form button...');
        await consentForm.click();
        await randomDelay(1500, 2500);
      }
    }

    // 2. Wait for feed
    const feedLocator = page.locator(SEL.feed);
    await feedLocator.waitFor({ timeout: 15000 }).catch(() => {
      console.log(`  [warn] Feed selector "${SEL.feed}" not found within timeout`);
    });

    const feedCount = await feedLocator.count();
    if (feedCount === 0) {
      console.log(`  [warn] No feed container found — logging page HTML for debugging`);
      const html = await page.content();
      console.log(html.substring(0, 2000));
    }

    // 3. Scroll feed to collect card hrefs
    await scrollUntil(page, SEL.feed, MAX_PLACES, SCROLL_ITER_CAP, SEL.card);

    const cardLinks = page.locator(SEL.cardLink);
    const cardCount = await cardLinks.count();
    console.log(`\nFound ${cardCount} place cards in feed`);

    if (cardCount === 0) {
      console.log(`  [warn] Selector "${SEL.cardLink}" found 0 cards — logging feed HTML`);
      const feedHtml = await feedLocator.first().innerHTML().catch(() => '');
      console.log(feedHtml.substring(0, 3000));
    }

    // Collect hrefs up front (avoid stale references after navigation)
    const hrefs: string[] = [];
    const limit = Math.min(cardCount, MAX_PLACES);
    for (let i = 0; i < limit; i++) {
      const href = await cardLinks.nth(i).getAttribute('href');
      if (href) hrefs.push(href);
    }
    console.log(`Collected ${hrefs.length} place hrefs\n`);

    // 4. Per-place scraping (sequential with delays)
    let hrefIdx = 0;
    for (const href of hrefs) {
      hrefIdx++;
      const placeId = parsePlaceIdFromHref(href);
      const ftid = parseFtidFromHref(href);
      const coords = parseCoordsFromHref(href);

      console.log(`[${hrefIdx}/${hrefs.length}] Scraping place_id=${placeId || '(unknown)'}`);

      await randomDelay(MIN_DELAY_MS, MAX_DELAY_MS);

      let panel: GoogleRawPlace['panel'];
      let reviews: GoogleRawPlace['reviews'];

      try {
        const result = await scrapeReviews(page, href);
        panel = {
          name: result.name,
          category: result.category,
          rating: result.rating,
          review_count: result.review_count,
        };
        reviews = result.reviews;
        console.log(
          `  name="${result.name}" category="${result.category}" ` +
            `rating=${result.rating} reviews=${reviews.length}`,
        );
      } catch (err) {
        console.error(`  [error] Failed to scrape place:`, err);
        panel = { name: '', category: '', rating: null, review_count: null };
        reviews = [];
      }

      places.push({
        place_id: placeId,
        ftid,
        place_href: href,
        panel,
        reviews,
        scraped_at,
        lat: coords?.lat,
        lng: coords?.lng,
      });
    }
  } finally {
    await browser.close();
  }

  // 5. Write raw output
  mkdirSync(OUT_DIR, { recursive: true });
  const output: GoogleRawOutput = {
    source: 'google',
    query: QUERY,
    fetched_via: 'playwright-chrome',
    scraped_at,
    places,
  };
  writeFileSync(OUT_FILE, JSON.stringify(output, null, 2));
  console.log(`\nRaw output written to: ${OUT_FILE}`);

  // 6. Summary
  const totalReviews = places.reduce((sum, p) => sum + p.reviews.length, 0);
  const placesWithReviews = places.filter((p) => p.reviews.length > 0).length;

  console.log('\n=== SCRAPE SUMMARY ===');
  console.log(`Places scraped:     ${places.length}`);
  console.log(`Places with reviews:${placesWithReviews}`);
  console.log(`Total reviews:      ${totalReviews}`);

  // Print 2 sample places
  const samples = places.filter((p) => p.reviews.length > 0).slice(0, 2);
  for (const p of samples) {
    console.log(`\n• ${p.panel.name} (${p.panel.category})`);
    console.log(`  place_id: ${p.place_id}`);
    console.log(`  rating: ${p.panel.rating}  reviews: ${p.panel.review_count}`);
    const r = p.reviews[0];
    if (r) {
      console.log(`  Sample review — "${r.author}" ${r.stars}★  ${r.date}`);
      console.log(`    "${r.text.substring(0, 120)}..."`);
    }
  }

  // 7. Optionally normalize
  if (normalizeMode) {
    console.log('\n');
    runNormalize();
  }
}

// ---------------------------------------------------------------------------
// NORMALIZE MODE
// ---------------------------------------------------------------------------

function runNormalize(): void {
  if (!existsSync(OUT_FILE)) {
    console.error(`[normalize] Raw file not found: ${OUT_FILE}`);
    process.exit(1);
  }

  const raw: GoogleRawOutput = JSON.parse(readFileSync(OUT_FILE, 'utf-8'));
  console.log(`[normalize] Processing ${raw.places.length} places from ${OUT_FILE}`);

  let nullCount = 0;
  let ok = 0;

  for (const place of raw.places) {
    const result = googlePlaceToRecord(place);
    if (!result) {
      nullCount++;
      console.log(`  [skip] place_id="${place.place_id}" — no coords or no place_id`);
      continue;
    }
    const { record } = result;
    const attrs = JSON.parse(record.attributes) as {
      rating: number | null;
      review_count: number | null;
      ftid: string;
      reviews: unknown[];
    };
    ok++;
    console.log(
      `  ✓ ${record.name}  record_uuid=${record.record_uuid}  reviews-in-attrs=${attrs.reviews.length}`,
    );
  }

  console.log(`\n[normalize] ${ok} records, ${nullCount} skipped`);
  if (ok > 0) {
    const firstOk = raw.places.find((p) => googlePlaceToRecord(p) !== null)!;
    const r = googlePlaceToRecord(firstOk)!;
    console.log(
      `[normalize] Sample record attributes (first OK): ${r.record.attributes.substring(0, 200)}`,
    );
  }
}

// ---------------------------------------------------------------------------

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
