import type { GroupRegistry } from '@travel/pipeline-core';

export interface IngestParams {
  source: string;
  region: string;
  bbox: [number, number, number, number];
  dataVersion: number;
}

export interface EnrichMessage {
  record_uuid: string;
  h3_r7: string;
  source: string;
}

export interface ExtractMessage {
  r2Key: string;
  url: string;
  source: string;
}

export interface Env {
  DATA: R2Bucket;
  GROUPS: D1Database;
  ENRICH: Queue<EnrichMessage>;
  EXTRACT: Queue<ExtractMessage>;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  INGEST: Workflow<IngestParams>;
  DATA_VERSION: string;
  /** Secret set via `wrangler secret put INGEST_TOKEN`. Required to call POST /ingest. */
  INGEST_TOKEN?: string;
}

// Re-export so the registry impl (Task 8) and workflow share one symbol.
export type { GroupRegistry };
