/**
 * Tier A — open bulk GeoParquet datasets on anonymous S3:
 *  - foursquare-os-places (Apache-2.0): 100M+ POIs, monthly + deltas.
 *  - overture (CDLA/ODbL per theme): Places ~60M+, monthly, stable GERS IDs.
 *
 * Delta strategy is the same shape: discover the latest release partition by
 * listing S3 (cheap, no download) → that release date/tag IS the source
 * fingerprint. Within a release, `date_refreshed` (FSQ) / per-release diff
 * (Overture deltas) give record-level delta. We additionally pull a few real
 * rows via DuckDB over httpfs to prove the data is reachable & parseable.
 */
import { defineConnector } from '../core/connector.js';
import { mkRecord, sourceFp, headFingerprint } from '../core/fingerprint.js';
import { s3List } from '../core/web.js';
import { duckQuery } from '../core/duck.js';

export const foursquareOsPlaces = defineConnector({
  id: 'foursquare-os-places',
  displayName: 'Foursquare Open Source Places',
  tier: 'A',
  coverage: 'Global, 100M+ POIs; Apache-2.0',
  plan: {
    access: 'Anonymous S3 GeoParquet (fsq-os-places-us-east-1) + Places Portal Iceberg',
    incremental: 'Monthly release partitions + a Deltas dataset; row-level via date_refreshed/date_created',
    fingerprint: 'latest release partition (dt=YYYY-MM-DD) discovered by S3 listing — no download',
  },
  async run(input, deps) {
    const base = 'https://fsq-os-places-us-east-1.s3.amazonaws.com';
    // Anonymous ListBucket on this bucket only enumerates the root (LICENSE/NOTICE);
    // the release/ partitions are not anonymously listable. We therefore (a) try the
    // release listing, and (b) always fall back to the NOTICE.txt header as a coarse
    // but real source fingerprint that flips when Foursquare republishes.
    const { prefixes } = await s3List(deps.fetch, base, 'release/');
    const releases = prefixes
      .map((p) => /dt=([0-9-]+)/.exec(p)?.[1])
      .filter((x): x is string => !!x)
      .sort();
    const latest = releases.at(-1);
    const notes: string[] = [];

    if (latest) {
      // Happy path: release partitions ARE listable (e.g. via Places Portal creds / mirror).
      const fp = sourceFp('release-date', { latestRelease: latest, releaseCount: releases.length });
      if (input.lastSnapshotFingerprint === fp.value) {
        return { status: 'ok', sourceFingerprint: fp, incremental: { method: 'dump-diff', supported: true, description: 'Release unchanged since last snapshot.' }, records: [], unchangedSinceSnapshot: true, notes: ['No new release since lastSnapshotFingerprint — skip.'] };
      }
      let records: ReturnType<typeof mkRecord>[] = [];
      try {
        const limit = Math.min(input.limit ?? 10, 25);
        const { keys } = await s3List(deps.fetch, base, `release/dt=${latest}/places/parquet/`);
        const file = keys.find((k) => k.endsWith('.parquet'));
        if (file) {
          const since = input.sinceTimestamp ? `WHERE date_refreshed >= DATE '${input.sinceTimestamp.slice(0, 10)}'` : '';
          const rows = await duckQuery(`SELECT fsq_place_id, name, latitude, longitude, date_refreshed FROM read_parquet('${base}/${file}') ${since} LIMIT ${limit}`, { timeoutMs: deps.timeoutMs - 5000 });
          records = rows.map((r) => mkRecord('foursquare-os-places', String(r.fsq_place_id), r, { name: r.name as string, lat: r.latitude as number, lng: r.longitude as number, updated_at: r.date_refreshed as string, raw: r }));
          notes.push(`DuckDB read ${records.length} rows from ${file.split('/').pop()} via httpfs.`);
        }
      } catch (e) {
        notes.push(`DuckDB row pull skipped: ${e instanceof Error ? e.message : String(e)}.`);
      }
      return { status: 'ok', sourceFingerprint: fp, incremental: { method: 'dump-diff', supported: true, description: 'New monthly release => new dt= partition (fingerprint flips). Row-level delta via date_refreshed or the Deltas dataset.', sinceApplied: input.sinceTimestamp }, records, notes: [`latest release dt=${latest}`, ...notes] };
    }

    // Fallback: enumerate root, fingerprint on NOTICE.txt (republished each release).
    const { keys } = await s3List(deps.fetch, base, '');
    const head = await headFingerprint(deps.fetch, `${base}/NOTICE.txt`);
    notes.push('Anonymous ListBucket does not expose release/ partitions; enumerate via Places Portal Iceberg catalog (token) or the Hugging Face mirror (foursquare/fsq-os-places).');
    notes.push('Bulk read path: DuckDB read_parquet over s3://fsq-os-places-us-east-1/release/dt=<date>/places/parquet/ once the dt is known.');
    return {
      status: 'partial',
      sourceFingerprint:
        head.fp ?? sourceFp('root-keys', { keys: keys.join(',') }),
      incremental: {
        method: 'dump-diff',
        supported: true,
        description: 'Monthly release partitions (dt=) + a Deltas dataset for change tracking; row-level delta via date_refreshed. Release enumeration needs portal/mirror, not anonymous S3 list.',
        sinceApplied: input.sinceTimestamp,
      },
      records: [],
      notes: [`bucket reachable (root keys: ${keys.join(', ') || 'none'})`, ...notes],
    };
  },
});

export const overture = defineConnector({
  id: 'overture',
  displayName: 'Overture Maps Foundation',
  tier: 'A',
  coverage: 'Global; Places ~60M+; CDLA-Permissive (places) / ODbL (base)',
  plan: {
    access: 'Anonymous S3 GeoParquet (overturemaps-us-west-2) + cloud marketplaces',
    incremental: 'Monthly release tag + stable GERS IDs → diff releases by GERS id/version',
    fingerprint: 'latest release tag (release/<YYYY-MM-DD.N>) discovered by S3 listing',
  },
  async run(input, deps) {
    const base = 'https://overturemaps-us-west-2.s3.amazonaws.com';
    const { prefixes } = await s3List(deps.fetch, base, 'release/');
    const tags = prefixes
      .map((p) => /release\/([^/]+)\//.exec(p)?.[1])
      .filter((x): x is string => !!x)
      .sort();
    const latest = tags.at(-1);
    const fp = sourceFp('release-tag', { latestRelease: latest ?? 'none', releaseCount: tags.length });
    const notes = [`Discovered ${tags.length} Overture releases; latest=${latest ?? 'none'}.`];
    let records: ReturnType<typeof mkRecord>[] = [];
    if (latest) {
      try {
        const limit = Math.min(input.limit ?? 10, 25);
        // HTTP globs aren't supported by DuckDB httpfs — list the concrete parquet
        // keys under type=place/ and read ONE file.
        const { keys } = await s3List(deps.fetch, base, `release/${latest}/theme=places/type=place/`);
        const file = keys.find((k) => k.endsWith('.parquet'));
        if (file) {
          const rows = await duckQuery(
            `SELECT id, names.primary AS name, bbox.xmin AS lng, bbox.ymin AS lat FROM read_parquet('${base}/${file}') LIMIT ${limit}`,
            { timeoutMs: deps.timeoutMs - 5000 },
          );
          records = rows.map((r) => mkRecord('overture', String(r.id), r, { name: r.name as string, lat: r.lat as number, lng: r.lng as number, raw: r }));
          notes.push(`DuckDB read ${records.length} Overture place rows from ${file.split('/').pop()} via httpfs.`);
        } else {
          notes.push('No .parquet key found under type=place/ (listing returned none).');
        }
      } catch (e) {
        notes.push(`DuckDB row pull skipped: ${e instanceof Error ? e.message : String(e)} (release fingerprint still captured).`);
      }
    }
    return {
      status: latest ? 'ok' : 'partial',
      sourceFingerprint: fp,
      incremental: {
        method: 'dump-diff',
        supported: true,
        description: 'New monthly release => new tag (fingerprint flips). GERS stable IDs let you diff a record across releases instead of re-ingesting all.',
        sinceApplied: input.sinceTimestamp,
      },
      records,
      notes,
    };
  },
});
