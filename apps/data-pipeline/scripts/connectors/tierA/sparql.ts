/**
 * Tier A — SPARQL knowledge bases: Wikidata (CC0) and DBpedia (CC-BY-SA).
 *
 * Wikidata exposes `schema:dateModified` per item → genuine timestamp delta
 * (api-since-param via a SPARQL FILTER). DBpedia has no live per-entity
 * timestamp; its delta is the periodic dump (dump-diff), so we fingerprint by
 * count + sampled IDs (the no-timestamp heuristic).
 */
import { defineConnector } from '../core/connector.js';
import { mkRecord, sourceFp } from '../core/fingerprint.js';
import { sparqlSelect } from '../core/web.js';

const WD = 'https://query.wikidata.org/sparql';
const DBP = 'https://dbpedia.org/sparql';

export const wikidata = defineConnector({
  id: 'wikidata',
  displayName: 'Wikidata (SPARQL + dumps)',
  tier: 'A',
  coverage: 'Global, hundreds of languages; CC0',
  plan: {
    access: 'Public SPARQL endpoint (query.wikidata.org) + weekly JSON/RDF dumps',
    incremental: 'SPARQL FILTER on schema:dateModified >= since (api-since-param); bulk via dump date',
    fingerprint: 'max(dateModified) + result count over the scoped class (timestamped → exact)',
  },
  async run(input, deps) {
    const limit = Math.min(input.limit ?? 25, 200);
    const sinceFilter = input.sinceTimestamp
      ? `FILTER(?modified >= "${input.sinceTimestamp}"^^xsd:dateTime)`
      : '';
    // Direct instances of "tourist attraction" (Q570116) with coordinates.
    const q = `
      SELECT ?item ?itemLabel ?coord ?modified WHERE {
        ?item wdt:P31 wd:Q570116 ; wdt:P625 ?coord ; schema:dateModified ?modified .
        ${sinceFilter}
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
      } ORDER BY DESC(?modified) LIMIT ${limit}`;
    const bindings = await sparqlSelect(deps.fetch, WD, q, deps.timeoutMs - 3000);
    const records = bindings.map((b) => {
      const qid = b.item!.value.split('/').pop()!;
      const m = /Point\(([-\d.]+) ([-\d.]+)\)/.exec(b.coord?.value ?? '');
      return mkRecord('wikidata', qid, { qid, label: b.itemLabel?.value, modified: b.modified?.value, coord: b.coord?.value }, {
        name: b.itemLabel?.value,
        updated_at: b.modified?.value,
        lng: m ? Number(m[1]) : undefined,
        lat: m ? Number(m[2]) : undefined,
        raw: b,
      });
    });
    const maxMod = records.map((r) => r.updated_at!).filter(Boolean).sort().at(-1) ?? 'none';
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('max-dateModified+count', { maxModified: maxMod, count: records.length, class: 'Q570116' }),
      incremental: {
        method: 'api-since-param',
        supported: true,
        description: 'schema:dateModified is queryable per item; FILTER(?modified >= since) returns only changed items. Exact, server-side.',
        sinceApplied: input.sinceTimestamp,
      },
      records,
      notes: [
        'WDQS public endpoint is fair-use throttled (~60s/query); self-host for bulk.',
        'For full-corpus delta use the weekly dump date + RDF "Recent Changes" stream.',
      ],
    };
  },
});

export const dbpedia = defineConnector({
  id: 'dbpedia',
  displayName: 'DBpedia (SPARQL + Databus dumps)',
  tier: 'A',
  coverage: 'Global, 125+ language editions; CC-BY-SA 3.0',
  plan: {
    access: 'Public SPARQL endpoint (dbpedia.org/sparql) + Databus RDF dumps',
    incremental: 'No live per-entity timestamp → delta is the periodic release (dump-diff)',
    fingerprint: 'release/version + count + sampled entity IDs (no-timestamp heuristic)',
  },
  async run(input, deps) {
    const limit = Math.min(input.limit ?? 25, 200);
    const q = `
      PREFIX dbo: <http://dbpedia.org/ontology/>
      PREFIX geo: <http://www.w3.org/2003/01/geo/wgs84_pos#>
      SELECT ?p ?lat ?long WHERE {
        ?p a dbo:Place ; geo:lat ?lat ; geo:long ?long .
      } LIMIT ${limit}`;
    // DBpedia's public endpoint returns transient 503s under load — retry a few times.
    let bindings: Awaited<ReturnType<typeof sparqlSelect>> = [];
    let lastErr = '';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        bindings = await sparqlSelect(deps.fetch, DBP, q, deps.timeoutMs - 3000);
        lastErr = '';
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        await new Promise((r) => setTimeout(r, 1500 * attempt));
      }
    }
    if (lastErr) {
      return {
        status: 'partial',
        sourceFingerprint: sourceFp('count+sampled-ids', { count: 0, note: 'endpoint unavailable this run' }),
        incremental: { method: 'dump-diff', supported: false, description: 'Track DBpedia release (monthly Core / quarterly Snapshot) + diff dumps; live SPARQL is best-effort.' },
        notes: [`DBpedia public SPARQL unavailable after 3 tries: ${lastErr}. Endpoint is known-flaky; prefer Databus RDF dumps for reliability.`],
      };
    }
    const records = bindings.map((b) => {
      const id = b.p!.value.split('/').pop()!;
      return mkRecord('dbpedia', id, { id, lat: b.lat?.value, long: b.long?.value }, {
        name: decodeURIComponent(id).replace(/_/g, ' '),
        lat: b.lat ? Number(b.lat.value) : undefined,
        lng: b.long ? Number(b.long.value) : undefined,
        raw: b,
      });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('count+sampled-ids', {
        count: records.length,
        sample: records.slice(0, 5).map((r) => r.source_id).join('|'),
      }),
      incremental: {
        method: 'dump-diff',
        supported: false,
        description: 'Live endpoint has no per-entity modified time; track the DBpedia release (monthly Core / quarterly Snapshot) and diff dumps. Per-record content_hash detects changes.',
      },
      records,
      notes: ['Public SPARQL is fair-use throttled; for bulk use Databus RDF dumps (Turtle/N-Triples).'],
    };
  },
});
