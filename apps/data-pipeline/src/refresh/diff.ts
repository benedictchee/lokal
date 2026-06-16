/** A minimal record shape for diffing — every PulledRecord satisfies it. */
export interface DiffableRecord {
  record_uuid: string;
  content_hash: string;
}

export interface RecordDiff<T extends DiffableRecord> {
  created: T[];
  changed: T[];
  unchanged: T[];
}

/**
 * Classify each pulled record against prior content hashes:
 *  - not in prior         → created
 *  - in prior, hash moved  → changed
 *  - in prior, hash equal   → unchanged
 */
export function classifyRecords<T extends DiffableRecord>(
  pulled: T[],
  prevHashByUuid: Map<string, string>,
): RecordDiff<T> {
  const created: T[] = [];
  const changed: T[] = [];
  const unchanged: T[] = [];
  for (const r of pulled) {
    const prev = prevHashByUuid.get(r.record_uuid);
    if (prev === undefined) created.push(r);
    else if (prev !== r.content_hash) changed.push(r);
    else unchanged.push(r);
  }
  return { created, changed, unchanged };
}
