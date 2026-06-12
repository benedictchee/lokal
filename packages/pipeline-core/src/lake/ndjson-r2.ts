import { toNdjsonLine, type TravelRecord } from '../record.js';
import type { LakeWriter } from './lake-writer.js';

/**
 * v1 SoT/analytics writer (D3): gzipped NDJSON → R2.
 *
 * Key scheme is DETERMINISTIC from data_version (NO wall-clock):
 *   lake/<subject>/<region>/v<dataVersion>.ndjson.gz
 * so a Workflow-step retry overwrites the same object and never duplicates.
 * DuckDB queries these gz NDJSON objects directly (zero egress).
 */
export class NdjsonR2LakeWriter implements LakeWriter {
  constructor(private readonly bucket: R2Bucket) {}

  async append(
    records: TravelRecord[],
    opts: { source: string; region: string; dataVersion: number },
  ): Promise<void> {
    if (records.length === 0) return;

    const subject = records[0]!.subject;
    const key = `lake/${subject}/${opts.region}/v${opts.dataVersion}.ndjson.gz`;

    const ndjson = records.map(toNdjsonLine).join('\n') + '\n';
    const gz = await gzip(ndjson);

    await this.bucket.put(key, gz, {
      httpMetadata: { contentEncoding: 'gzip', contentType: 'application/x-ndjson' },
    });
  }
}

async function gzip(text: string): Promise<ArrayBuffer> {
  const stream = new Response(text).body!.pipeThrough(new CompressionStream('gzip'));
  return await new Response(stream).arrayBuffer();
}
