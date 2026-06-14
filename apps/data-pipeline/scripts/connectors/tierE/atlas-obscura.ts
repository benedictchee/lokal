/**
 * Tier E — Atlas Obscura (no API; scrape-only / ToS-risky). DEMO of the browser
 * path + the sitemap fingerprint heuristic for no-timestamp / no-API sources.
 *
 * Fingerprint (cheap, no browser): fetch the sitemap and take max(<lastmod>) +
 * URL count — flips whenever a place page is added/edited. Records (real pull):
 * gated behind PROBE_BROWSER=1, launches system Chrome and extracts place cards
 * from a destination listing page.
 */
import { defineConnector } from '../core/connector.js';
import { mkRecord, sourceFp, sitemapProbe } from '../core/fingerprint.js';
import { browserEnabled, withPage } from '../core/browser.js';

export const atlasObscura = defineConnector({
  id: 'atlas-obscura',
  displayName: 'Atlas Obscura',
  tier: 'E',
  coverage: 'Global, EN; ~32k offbeat POIs; ToS reserves all rights',
  plan: {
    access: 'No API. Browser scrape (Playwright/Chrome) of place pages; ToS-risky.',
    incremental: 'Sitemap <lastmod> per place URL → changed-URL set (sitemap-lastmod). No API timestamp.',
    fingerprint: 'max(sitemap lastmod) + URL count (no-timestamp heuristic)',
  },
  async run(input, deps) {
    const notes: string[] = [];
    // 1) Cheap change-detection fingerprint via sitemap (no browser, ToS-light).
    const sm = await sitemapProbe(deps.fetch, 'https://www.atlasobscura.com/sitemap.xml');
    const fp =
      sm && !sm.challenge
        ? sourceFp('sitemap-lastmod-max', { maxLastmod: sm.maxLastmod ?? 'none', urlCount: sm.urlCount, sample: sm.sampleLoc ?? '' })
        : sourceFp('none', { reason: sm?.challenge ?? 'sitemap unreachable' });
    if (sm?.challenge) notes.push(`Sitemap blocked: ${sm.challenge} — even the sitemap is WAF-protected; cheap fingerprinting not possible without solving the challenge.`);
    else if (sm) notes.push(`Sitemap probe: ${sm.urlCount} entries, maxLastmod=${sm.maxLastmod ?? 'n/a'} (this is the delta heuristic).`);

    // 2) Records: only if browser probing is explicitly enabled.
    if (!browserEnabled(deps.env)) {
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: {
          method: 'sitemap-lastmod',
          supported: !!sm,
          description: 'Sitemap <lastmod> gives the changed-URL set since T without scraping every page. Page bodies require a browser (no API).',
        },
        notes: [...notes, 'No sanctioned API; set PROBE_BROWSER=1 to attempt a Chrome scrape of place cards. ToS reserves all rights — partnership/licence needed for real ingestion.'],
      };
    }
    try {
      const limit = Math.min(input.limit ?? 10, 20);
      const records = await withPage(async (page) => {
        await page.goto('https://www.atlasobscura.com/places', { waitUntil: 'domcontentloaded' });
        const items = await page.$$eval(
          'a[href*="/places/"]',
          (els, max) =>
            els
              .map((e) => ({ href: (e as HTMLAnchorElement).href, title: (e.textContent ?? '').trim() }))
              .filter((x) => x.title && /\/places\/[a-z0-9-]+$/.test(x.href))
              .slice(0, max as number),
          limit,
        );
        return items;
      }, { timeoutMs: deps.timeoutMs - 5000 });
      const recs = records.map((it) => {
        const slug = it.href.split('/places/')[1]!;
        return mkRecord('atlas-obscura', slug, it, { name: it.title, raw: it });
      });
      return {
        status: recs.length ? 'ok' : 'partial',
        sourceFingerprint: fp,
        incremental: { method: 'sitemap-lastmod', supported: !!sm, description: 'Sitemap lastmod → changed set; scrape only those place pages.' },
        records: recs,
        notes: [...notes, `Chrome scrape extracted ${recs.length} place cards from /places.`],
      };
    } catch (e) {
      return {
        status: 'blocked',
        sourceFingerprint: fp,
        incremental: { method: 'sitemap-lastmod', supported: !!sm, description: 'Sitemap lastmod heuristic; browser scrape failed.' },
        notes: [...notes, `Browser scrape failed: ${e instanceof Error ? e.message : String(e)} (likely anti-bot or selector drift).`],
      };
    }
  },
});
