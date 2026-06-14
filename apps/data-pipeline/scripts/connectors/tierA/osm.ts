/**
 * Tier A — OpenStreetMap (ODbL). Two connectors:
 *  - osm-overpass: live query for a bbox; delta via the `newer:"T"` filter.
 *  - osm-planet-geofabrik: bulk extracts; delta via replication diffs; fingerprint
 *    from the replication state sequence (monotonic) — the canonical "did the
 *    planet advance?" check without downloading the PBF.
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, mkRecord, sourceFp, headFingerprint, UA } from '../core/fingerprint.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
// Penang island default bbox (matches the existing build-map dataset).
const DEFAULT_BBOX: [number, number, number, number] = [5.2, 100.15, 5.5, 100.35];

export const osmOverpass = defineConnector({
  id: 'osm-overpass',
  displayName: 'OpenStreetMap — Overpass API',
  tier: 'A',
  coverage: 'Global, name:* per language; ODbL',
  plan: {
    access: 'Public Overpass endpoints (free, 1 req/s shared); self-host for bulk',
    incremental: 'Overpass QL `newer:"T"` / augmented-diff (adiff) returns elements changed since T',
    fingerprint: 'replication minute-sequence (from planet replication state) + element count',
  },
  async run(input, deps) {
    const [s, w, n, e] = DEFAULT_BBOX;
    const box = `(${s},${w},${n},${e})`;
    const newer = input.sinceTimestamp ? `(newer:"${input.sinceTimestamp}")` : '';
    const limit = Math.min(input.limit ?? 25, 200);
    const query = `[out:json][timeout:60];(nwr["tourism"]${box}${newer};nwr["amenity"="restaurant"]${box}${newer};);out center ${limit};`;
    const res = await fetchT(deps.fetch, OVERPASS, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'content-type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      timeoutMs: deps.timeoutMs - 3000,
    });
    const json = (await res.json()) as { elements?: Array<{ type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }>; osm3s?: { timestamp_osm_base?: string } };
    const els = json.elements ?? [];
    const records = els.slice(0, limit).map((el) => {
      const sid = `${el.type}/${el.id}`;
      return mkRecord('osm-overpass', sid, { tags: el.tags ?? {} }, {
        name: el.tags?.name,
        lat: el.lat ?? el.center?.lat,
        lng: el.lon ?? el.center?.lon,
        raw: { tags: el.tags },
      });
    });
    // osm3s.timestamp_osm_base is the data cut timestamp — perfect source fingerprint.
    const base = json.osm3s?.timestamp_osm_base ?? 'unknown';
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('osm-base-timestamp+count', { osmBase: base, count: els.length, bbox: box }),
      incremental: {
        method: 'changes-feed',
        supported: true,
        description: 'newer:"T" filter (used this run when --since given) returns only elements edited after T; augmented diffs for full change sets.',
        sinceApplied: input.sinceTimestamp,
      },
      records,
      notes: ['Public Overpass is 1 req/s shared; bbox-chunk + self-host for scale.', `osm3s base cut: ${base}`],
    };
  },
});

export const osmPlanet = defineConnector({
  id: 'osm-planet-geofabrik',
  displayName: 'OpenStreetMap — Planet/Geofabrik bulk',
  tier: 'A',
  coverage: 'Global; regional .osm.pbf extracts; ODbL',
  plan: {
    access: 'File download: planet.osm.pbf + Geofabrik regional extracts (no key)',
    incremental: 'Replication diffs (minute/hour/day) applied from a stored sequence number',
    fingerprint: 'Geofabrik extract Last-Modified + internal replication state sequence',
  },
  async run(_input, deps) {
    // Use the Malaysia-Singapore-Brunei extract as the probe target.
    const pbfUrl = 'https://download.geofabrik.de/asia/malaysia-singapore-brunei-latest.osm.pbf';
    const stateUrl = 'https://download.geofabrik.de/asia/malaysia-singapore-brunei-updates/state.txt';
    const head = await headFingerprint(deps.fetch, pbfUrl);
    let seq: string | null = null;
    let stateTs: string | null = null;
    try {
      const res = await fetchT(deps.fetch, stateUrl, { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
      if (res.ok) {
        const txt = await res.text();
        seq = /sequenceNumber=(\d+)/.exec(txt)?.[1] ?? null;
        stateTs = /timestamp=([^\s]+)/.exec(txt)?.[1]?.replace(/\\:/g, ':') ?? null;
      }
    } catch {
      /* state optional */
    }
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('replication-sequence', {
        sequenceNumber: seq ?? 'unknown',
        stateTimestamp: stateTs ?? 'unknown',
        pbfLastModified: head.headers['last-modified'] ?? 'unknown',
        pbfBytes: head.headers['content-length'] ?? 'unknown',
      }),
      incremental: {
        method: 'dump-diff',
        supported: true,
        description: 'Store sequenceNumber; on next run apply replication diffs (osmupdate/osmium) from that sequence forward. No re-download of the full PBF.',
      },
      // Bulk connector: we fingerprint the extract rather than stream 400MB in a prototype.
      records: [],
      notes: [
        `Geofabrik extract Last-Modified: ${head.headers['last-modified'] ?? 'n/a'}; size: ${head.headers['content-length'] ?? 'n/a'} bytes.`,
        `Replication state seq=${seq ?? 'n/a'} ts=${stateTs ?? 'n/a'} — this is the delta cursor.`,
        'Records intentionally not streamed in prototype (bulk PBF); osmium/pyosmium would parse + filter POIs.',
      ],
    };
  },
});
