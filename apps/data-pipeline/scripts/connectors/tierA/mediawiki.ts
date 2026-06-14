/**
 * Tier A — MediaWiki projects: Wikipedia & Wikivoyage (CC-BY-SA 4.0).
 *
 * Both expose the RecentChanges feed — a true changes-feed delta: ask for ns0
 * edits with rcend=since and you get exactly the pages touched since T. The
 * source fingerprint is the latest change timestamp + revid (monotonic).
 */
import { defineConnector } from '../core/connector.js';
import { mkRecord, sourceFp } from '../core/fingerprint.js';
import { mwRecentChanges } from '../core/web.js';

function mwConnector(id: string, displayName: string, apiBase: string, coverage: string) {
  return defineConnector({
    id,
    displayName,
    tier: 'A',
    coverage,
    plan: {
      access: 'MediaWiki Action/REST API + monthly XML/SQL dumps (dumps.wikimedia.org)',
      incremental: 'list=recentchanges with rcend=since → exact set of pages changed since T (changes-feed)',
      fingerprint: 'latest change timestamp + revid (monotonic); bulk via dump date',
    },
    async run(input, deps) {
      const limit = Math.min(input.limit ?? 25, 100);
      const { changes, latest } = await mwRecentChanges(deps.fetch, apiBase, {
        since: input.sinceTimestamp,
        limit,
        timeoutMs: deps.timeoutMs - 3000,
      });
      const records = changes.map((c) =>
        mkRecord(id, String(c.pageid), { pageid: c.pageid, title: c.title, revid: c.revid }, {
          name: c.title,
          updated_at: c.timestamp,
          raw: c,
        }),
      );
      const topRev = changes[0]?.revid ?? 0;
      return {
        status: 'ok',
        sourceFingerprint: sourceFp('latest-timestamp+revid', { latest: latest ?? 'none', topRevId: topRev, count: records.length }),
        incremental: {
          method: 'changes-feed',
          supported: true,
          description: 'RecentChanges (rcend=since) returns pages edited since T. Page bodies fetched per title; geo-scope via list=geosearch.',
          sinceApplied: input.sinceTimestamp,
        },
        records,
        notes: [
          'Anonymous API ~500 req/hr/IP; authenticated ~5000.',
          'For POI extraction, join page titles to Wikidata (P625 coords) rather than parsing prose.',
        ],
      };
    },
  });
}

export const wikipedia = mwConnector(
  'wikipedia',
  'Wikipedia (REST/Action API + dumps)',
  'https://en.wikipedia.org/w/api.php',
  'Global, 300+ language editions; CC-BY-SA 4.0',
);

export const wikivoyage = mwConnector(
  'wikivoyage',
  'Wikivoyage (travel guides)',
  'https://en.wikivoyage.org/w/api.php',
  'Global travel guides, ~25+ editions; CC-BY-SA 4.0',
);
