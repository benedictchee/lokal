import type { TravelRecord } from '../record.js';
import type { MatchSignals } from '../types.js';
import { deriveCells } from '../h3.js';

/** The shape every connector PulledRecord shares (kept local to avoid a scripts/ import). */
export interface PulledRecordLike {
  source_id: string;
  record_uuid: string;
  content_hash: string;
  source_url?: string;
  name?: string;
  lat?: number;
  lng?: number;
}

/** Per-source classification the pull cannot supply itself. */
export interface ConnectorMapping {
  subject: string;
  category: string;
  lang?: string;
  /** Optional ER signals (e.g. brand) when the source exposes them. */
  signals?: MatchSignals;
}

/** Fields a normalizer knows up front — the orchestration adds group_uuid/data_version/raw_r2_key. */
type NormalizedRecord = Omit<TravelRecord, 'group_uuid' | 'data_version' | 'raw_r2_key'>;

/**
 * Convert a connector PulledRecord into a normalized TravelRecord (minus the
 * fields the orchestration owns) plus ER match signals. Returns null when the
 * record lacks coordinates or a name — mirrors osmElementToRecord's contract.
 */
export function pulledToNormalized(
  connectorId: string,
  pr: PulledRecordLike,
  mapping: ConnectorMapping,
): { record: NormalizedRecord; signals: MatchSignals } | null {
  if (!pr.name) return null;
  if (typeof pr.lat !== 'number' || typeof pr.lng !== 'number') return null;

  const cells = deriveCells(pr.lat, pr.lng);
  const record: NormalizedRecord = {
    record_uuid: pr.record_uuid,
    subject: mapping.subject,
    category: mapping.category,
    name: pr.name,
    lat: pr.lat,
    lng: pr.lng,
    h3_r5: cells.h3_r5,
    h3_r7: cells.h3_r7,
    h3_r10: cells.h3_r10,
    attributes: '{}',
    source: connectorId,
    source_id: pr.source_id,
    source_url: pr.source_url ?? '',
    lang: mapping.lang ?? 'en',
    content_hash: pr.content_hash,
  };
  return { record, signals: mapping.signals ?? {} };
}
