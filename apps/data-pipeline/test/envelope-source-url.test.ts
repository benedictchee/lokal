import { describe, it, expect } from 'vitest';
import { mkRecord } from '../scripts/connectors/core/fingerprint.js';

describe('mkRecord carries source_url', () => {
  it('passes source_url through into the PulledRecord', () => {
    const r = mkRecord('wikidata', 'Q42', { a: 1 }, { name: 'Douglas', source_url: 'https://www.wikidata.org/entity/Q42' });
    expect(r.source_url).toBe('https://www.wikidata.org/entity/Q42');
    expect(r.record_uuid).toBeTruthy();
    expect(r.content_hash).toBeTruthy();
  });
});
