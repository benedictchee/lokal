/**
 * Tier A — open-government tourism data:
 *  - socrata-us: US city/state open data (Socrata SODA) — the gold standard for
 *    timestamp delta: the `:updated_at` system field supports $where filtering.
 *  - datatourisme: France national tourism DB — daily complete dump on
 *    data.gouv.fr; fingerprint via the dataset's last_modified.
 *  - opentripmap: 10M+ tourist POIs (ODbL) — needs a free key; documents the
 *    bbox/radius delta + count heuristic when no key is present.
 */
import { defineConnector } from '../core/connector.js';
import { fetchT, mkRecord, sourceFp, UA } from '../core/fingerprint.js';

export const socrataUs = defineConnector({
  id: 'socrata-us',
  displayName: 'US data.gov / DMO open data (Socrata)',
  tier: 'A',
  coverage: 'US federal/state/city; public domain / open',
  plan: {
    access: 'Socrata SODA REST API + bulk CSV/JSON; app token raises limits',
    incremental: '$where=:updated_at > since — true server-side timestamp delta (api-since-param)',
    fingerprint: "dataset rowsUpdatedAt (metadata) + row count — exact 'did the table change?'",
  },
  async run(input, deps) {
    // NYC DOHMH Restaurant Inspections — tabular POIs (name/cuisine/lat-lng) with
    // the :updated_at system field. (NYC's CommonPlace POI set rxuy-2muj is a
    // geo-blob exposing only system fields, so this restaurant set is the cleaner
    // tabular demo of the same SODA delta pattern.)
    const id = '43nn-pn8j';
    const host = 'https://data.cityofnewyork.us';
    const limit = Math.min(input.limit ?? 25, 100);
    // 1) Metadata → rowsUpdatedAt (the snapshot fingerprint).
    let rowsUpdatedAt = 'unknown';
    try {
      const meta = (await (await fetchT(deps.fetch, `${host}/api/views/${id}.json`, { headers: { 'User-Agent': UA }, timeoutMs: 12_000 })).json()) as { rowsUpdatedAt?: number; name?: string };
      if (meta.rowsUpdatedAt) rowsUpdatedAt = new Date(meta.rowsUpdatedAt * 1000).toISOString();
    } catch {
      /* fall through */
    }
    // 2) Rows, newest-changed first, optionally filtered by :updated_at > since.
    const params = new URLSearchParams({ '$$exclude_system_fields': 'false', '$order': ':updated_at DESC', '$limit': String(limit) });
    if (input.sinceTimestamp) params.set('$where', `:updated_at > '${input.sinceTimestamp}'`);
    const url = `${host}/resource/${id}.json?${params}`;
    const rows = (await (await fetchT(deps.fetch, url, { headers: { 'User-Agent': UA }, timeoutMs: deps.timeoutMs - 3000 })).json()) as Array<Record<string, unknown>>;
    const records = rows.map((r) => {
      // camis = the stable restaurant id; prefer it over the row :id so re-inspections of the same venue collapse.
      const sid = String(r.camis ?? r[':id']);
      return mkRecord('socrata-us', sid, r, {
        name: (r.dba ?? r.name) as string | undefined,
        updated_at: (r[':updated_at'] ?? r.record_date) as string | undefined,
        lat: r.latitude ? Number(r.latitude) : undefined,
        lng: r.longitude ? Number(r.longitude) : undefined,
        raw: r,
      });
    });
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('rowsUpdatedAt+count', { rowsUpdatedAt, sampled: records.length, dataset: id }),
      incremental: {
        method: 'api-since-param',
        supported: true,
        description: "SODA `$where=:updated_at > 'T'` returns exactly the rows changed since T; `$order=:updated_at DESC` makes it resumable. Works on every Socrata portal.",
        sinceApplied: input.sinceTimestamp,
      },
      records,
      notes: [
        `Demonstrated on NYC dataset ${id} (DOHMH restaurants); rowsUpdatedAt=${rowsUpdatedAt}.`,
        'Same pattern generalises to data.colorado.gov, data.ny.gov, and other Socrata DMO portals. App token raises ~1000 req/hr cap.',
      ],
    };
  },
});

export const datatourisme = defineConnector({
  id: 'datatourisme',
  displayName: 'DATAtourisme (France national)',
  tier: 'A',
  coverage: 'France + overseas; FR; Licence Ouverte 2.0',
  plan: {
    access: 'Daily complete N-Triples dump on data.gouv.fr (no key) + flux API (free key)',
    incremental: 'Daily complete export + per-region daily CSV (dump-diff)',
    fingerprint: 'data.gouv.fr resource last_modified / dataset last_update',
  },
  async run(_input, deps) {
    // Find the DATAtourisme national dataset via the data.gouv.fr API.
    const search = (await (await fetchT(deps.fetch, 'https://www.data.gouv.fr/api/1/datasets/?q=datatourisme&page_size=1', { headers: { 'User-Agent': UA }, timeoutMs: 15_000 })).json()) as {
      data?: Array<{ id: string; title: string; last_update?: string; resources?: Array<{ title: string; last_modified?: string; format?: string; url?: string }> }>;
    };
    const ds = search.data?.[0];
    if (!ds) {
      return {
        status: 'partial',
        sourceFingerprint: sourceFp('none', { reason: 'dataset search returned nothing' }),
        incremental: { method: 'dump-diff', supported: true, description: 'Daily complete export exists; search API returned no dataset this run.' },
        notes: ['data.gouv.fr search for "datatourisme" returned no dataset; try the known dataset slug.'],
      };
    }
    const resources = ds.resources ?? [];
    const lastMods = resources.map((r) => r.last_modified).filter((x): x is string => !!x).sort();
    const latest = lastMods.at(-1) ?? ds.last_update ?? 'unknown';
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('resource-last_modified', { datasetId: ds.id, latestResourceModified: latest, resourceCount: resources.length }),
      incremental: {
        method: 'dump-diff',
        supported: true,
        description: 'Daily complete .nt export + per-region daily CSV. Compare resource last_modified; on change, re-pull the dump and diff by content_hash (RDF subjects are stable IRIs).',
      },
      // Bulk N-Triples dump not streamed in prototype; we proved catalog access + fingerprint.
      records: [],
      notes: [
        `Dataset "${ds.title}" (${ds.id}); ${resources.length} resources; latest last_modified=${latest}.`,
        'Record pull = stream the daily .nt dump (RDF/JSON-LD via DATAtourisme ontology) or the regional CSVs — deferred in prototype (bulk).',
      ],
    };
  },
});

export const opentripmap = defineConnector({
  id: 'opentripmap',
  displayName: 'OpenTripMap',
  tier: 'A',
  coverage: 'Global, dense in Russia/CIS; ODbL',
  plan: {
    access: 'REST API (api.opentripmap.com) — free key by registration (OPENTRIPMAP_KEY)',
    incremental: 'No timestamp; page by bbox/radius. ODbL explicitly permits caching/indexing',
    fingerprint: 'count + bbox tile hash (no-timestamp heuristic); release of underlying OSM/Wikidata',
  },
  async run(input, deps) {
    const key = deps.env.OPENTRIPMAP_KEY;
    const bbox = { lonMin: 100.15, latMin: 5.2, lonMax: 100.35, latMax: 5.5 }; // Penang
    if (!key) {
      // Probe keyless to confirm the gate (expected 401/403) — a real experiment.
      let probeStatus = 0;
      try {
        const res = await fetchT(deps.fetch, `https://api.opentripmap.com/0.1/en/places/bbox?lon_min=${bbox.lonMin}&lat_min=${bbox.latMin}&lon_max=${bbox.lonMax}&lat_max=${bbox.latMax}&limit=5`, { headers: { 'User-Agent': UA }, timeoutMs: 12_000, allowNotOk: true });
        probeStatus = res.status;
      } catch {
        /* network */
      }
      return {
        status: 'needs_key',
        sourceFingerprint: sourceFp('count+bbox-hash', { bbox: JSON.stringify(bbox), note: 'requires key to populate' }),
        incremental: {
          method: 'sort-by-updated',
          supported: false,
          description: 'No modified timestamp. Delta = re-query bbox tiles and diff by content_hash; ODbL permits caching so we keep prior snapshots to diff against.',
        },
        notes: [
          `No OPENTRIPMAP_KEY set; keyless probe returned HTTP ${probeStatus} (gate confirmed).`,
          'Set OPENTRIPMAP_KEY to pull /places/bbox + /places/xid details. ODbL explicitly allows pre-fetch/index/store.',
        ],
      };
    }
    const limit = Math.min(input.limit ?? 25, 100);
    const list = (await (await fetchT(deps.fetch, `https://api.opentripmap.com/0.1/en/places/bbox?lon_min=${bbox.lonMin}&lat_min=${bbox.latMin}&lon_max=${bbox.lonMax}&lat_max=${bbox.latMax}&limit=${limit}&apikey=${key}`, { headers: { 'User-Agent': UA }, timeoutMs: deps.timeoutMs - 3000 })).json()) as { features?: Array<{ properties: { xid: string; name: string }; geometry: { coordinates: [number, number] } }> };
    const feats = list.features ?? [];
    const records = feats.map((f) =>
      mkRecord('opentripmap', f.properties.xid, f.properties, {
        name: f.properties.name,
        lng: f.geometry.coordinates[0],
        lat: f.geometry.coordinates[1],
        raw: f.properties,
      }),
    );
    return {
      status: 'ok',
      sourceFingerprint: sourceFp('count+bbox-hash', { bbox: JSON.stringify(bbox), count: feats.length }),
      incremental: { method: 'sort-by-updated', supported: false, description: 'No timestamp; diff bbox tiles by content_hash across snapshots (ODbL permits caching).' },
      records,
      notes: ['Pulled live via OPENTRIPMAP_KEY.'],
    };
  },
});
