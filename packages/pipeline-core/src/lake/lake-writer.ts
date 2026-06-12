import type { TravelRecord } from '../record.js';

/**
 * Source-of-truth / analytics write tier (D3). v1 impl: NDJSON → R2.
 * Future impl: Iceberg/Pipelines (drop-in replacement).
 */
export interface LakeWriter {
  append(
    records: TravelRecord[],
    opts: { source: string; region: string; dataVersion: number },
  ): Promise<void>;
}
