import { NonRetryableError } from 'cloudflare:workflows';
import { mkRecord } from '../../scripts/connectors/core/fingerprint.js';
import { parseHtml } from '../../scripts/connectors/core/parse-html.js';
import type { PulledRecord } from '../../scripts/connectors/core/types.js';
import { PILOT_SOURCES } from './pilot-sources.js';
import { gunzipToString } from './gzip.js';
import { ingestPulledRecords } from '../refresh/ingest-records.js';
import type { RefreshEnv } from '../refresh/run-refresh.js';
import type { ExtractMessage } from '../env.js';

const EXTRACT_LIMIT = 25;

/**
 * Consume travel-extract messages: load the device DOM from R2, parse it, run the
 * owning connector's static-DOM extractor, and feed the records through the shared
 * record-level ingest. Unrecoverable input (missing object, unknown source,
 * unparseable DOM) throws NonRetryableError → DLQ.
 */
export async function extractBatch(msgs: ExtractMessage[], env: RefreshEnv): Promise<void> {
  for (const msg of msgs) {
    const pilot = PILOT_SOURCES[msg.source];
    if (!pilot) throw new NonRetryableError(`extract: unknown source "${msg.source}" for ${msg.url}`);

    const obj = await env.DATA.get(msg.r2Key);
    if (obj === null) throw new NonRetryableError(`extract: R2 object missing at ${msg.r2Key}`);
    // The pool DOM is stored gzip (handlers.ts), and R2.get() does NOT transparently
    // inflate the body — contentEncoding is response-header metadata only. Gunzip the
    // bytes ourselves, matching the rest of the pool read path (gunzipToString).
    const html = await gunzipToString(new Uint8Array(await obj.arrayBuffer()));

    let items;
    try {
      items = pilot.strategy.extract(parseHtml(html), msg.url, EXTRACT_LIMIT);
    } catch (cause) {
      throw new NonRetryableError(`extract: parse/extract failed for ${msg.url}: ${String(cause)}`);
    }

    const records: PulledRecord[] = items.map((it) =>
      mkRecord(msg.source, it.sourceId, it.raw ?? it, {
        name: it.name, lat: it.lat, lng: it.lng, updated_at: it.updated_at, source_url: it.url,
      }),
    );

    const nowIso = new Date().toISOString();
    await ingestPulledRecords(env, msg.source, pilot.mapping, records, {
      dataVersion: Number((env as unknown as { DATA_VERSION?: string }).DATA_VERSION ?? 1),
      nowIso,
      runId: crypto.randomUUID(),
    });
  }
}
