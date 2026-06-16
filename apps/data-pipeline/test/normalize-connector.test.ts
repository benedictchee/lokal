import { describe, it, expect } from 'vitest';
import { pulledToNormalized } from '@travel/pipeline-core';
import type { PulledRecord } from '../scripts/connectors/core/types.js';

const pr: PulledRecord = {
  source_id: 'Q570116',
  record_uuid: 'ruuid-1',
  content_hash: 'h1',
  source_url: 'https://www.wikidata.org/entity/Q570116',
  name: 'Penang Hill',
  lat: 5.4253,
  lng: 100.2685,
};

describe('pulledToNormalized', () => {
  it('builds a normalized record with derived h3 cells and carried fields', () => {
    const out = pulledToNormalized('wikidata', pr, { subject: 'poi', category: 'attraction' });
    expect(out).not.toBeNull();
    const { record } = out!;
    expect(record.subject).toBe('poi');
    expect(record.category).toBe('attraction');
    expect(record.name).toBe('Penang Hill');
    expect(record.source).toBe('wikidata');
    expect(record.source_id).toBe('Q570116');
    expect(record.source_url).toBe('https://www.wikidata.org/entity/Q570116');
    expect(record.content_hash).toBe('h1');
    expect(record.h3_r10.length).toBe(15);
    expect(record.h3_r7.length).toBe(15);
    expect(record.lang).toBe('en');
  });

  it('returns null when the record has no coordinates', () => {
    const noCoords: PulledRecord = { ...pr, lat: undefined, lng: undefined };
    expect(pulledToNormalized('wikidata', noCoords, { subject: 'poi', category: 'attraction' })).toBeNull();
  });

  it('returns null when the record has no name', () => {
    const noName: PulledRecord = { ...pr, name: undefined };
    expect(pulledToNormalized('wikidata', noName, { subject: 'poi', category: 'attraction' })).toBeNull();
  });
});
