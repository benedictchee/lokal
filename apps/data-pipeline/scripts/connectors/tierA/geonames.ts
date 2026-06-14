/**
 * Tier A — GeoNames (CC-BY 4.0). Gazetteer of ~12M place names.
 *
 * Best delta: GeoNames publishes daily `modifications-YYYY-MM-DD.txt` and
 * `deletes-YYYY-MM-DD.txt` files — a clean dump-diff. We fetch the most recent
 * available modifications file and parse its rows. Fingerprint = that file's
 * date + row count (each row also carries a per-record modification date).
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, mkRecord, sourceFp, UA } from '../core/fingerprint.js';

const BASE = 'https://download.geonames.org/export/dump';

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const geonames = defineConnector({
  id: 'geonames',
  displayName: 'GeoNames (dumps + daily diffs)',
  tier: 'A',
  coverage: 'Global, multilingual alt-names; CC-BY 4.0',
  plan: {
    access: 'Bulk dumps + daily modifications/deletes files (download.geonames.org), no key',
    incremental: 'Daily modifications-<date>.txt / deletes-<date>.txt (dump-diff) — exact delta',
    fingerprint: 'latest modifications-file date + row count (each row carries its own mod date)',
  },
  async run(input, deps) {
    const limit = Math.min(input.limit ?? 25, 500);
    // Walk back from yesterday to find the newest published modifications file.
    let used: { date: string; body: string } | null = null;
    for (let back = 1; back <= 5 && !used; back++) {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - back);
      const date = ymd(d);
      try {
        const res = await fetchT(deps.fetch, `${BASE}/modifications-${date}.txt`, {
          headers: { 'User-Agent': UA },
          timeoutMs: 15_000,
          allowNotOk: true,
        });
        if (res.ok) {
          used = { date, body: await res.text() };
        }
      } catch {
        /* try previous day */
      }
    }
    if (!used) {
      return {
        status: 'partial',
        sourceFingerprint: sourceFp('none', { reason: 'no recent modifications file found' }),
        incremental: { method: 'dump-diff', supported: true, description: 'Daily modifications/deletes files exist; none found in last 5 days window (mirror lag?).' },
        notes: ['Could not locate a modifications file in the last 5 days; fall back to allCountries.zip Last-Modified.'],
      };
    }
    const lines = used.body.split('\n').filter(Boolean);
    // GeoNames dump columns: geonameid \t name \t asciiname \t altnames \t lat \t lng \t fclass \t fcode \t ... \t modificationDate
    const records = lines.slice(0, limit).map((ln) => {
      const c = ln.split('\t');
      return mkRecord('geonames', c[0]!, ln, {
        name: c[1],
        lat: c[4] ? Number(c[4]) : undefined,
        lng: c[5] ? Number(c[5]) : undefined,
        updated_at: c.at(-1),
        raw: { geonameid: c[0], name: c[1], fclass: c[6], fcode: c[7] },
      });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('latest-diff-date+rows', { diffDate: used.date, rows: lines.length }),
      incremental: {
        method: 'dump-diff',
        supported: true,
        description: `Fetched modifications-${used.date}.txt (${lines.length} rows) = exact daily delta. Pair with deletes-${used.date}.txt for removals.`,
        sinceApplied: used.date,
      },
      records,
      notes: [`Daily delta file modifications-${used.date}.txt parsed.`, 'Full base: allCountries.zip (HEAD Last-Modified as coarse fingerprint).'],
    };
  },
});
