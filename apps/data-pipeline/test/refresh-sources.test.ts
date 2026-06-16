import { describe, it, expect } from 'vitest';
import { REFRESH_SOURCES } from '../src/refresh/sources.js';

describe('REFRESH_SOURCES registry', () => {
  it('registers the six open keyless connectors, keyed by connector.id', () => {
    expect(Object.keys(REFRESH_SOURCES).sort()).toEqual([
      'dbpedia', 'geonames', 'socrata-us', 'wikidata', 'wikipedia', 'wikivoyage',
    ]);
  });

  it('every entry has a matching connector id, a mapping, and a positive cadence', () => {
    for (const [id, cfg] of Object.entries(REFRESH_SOURCES)) {
      expect(cfg.connector.id).toBe(id);
      expect(cfg.mapping.subject).toBeTruthy();
      expect(cfg.mapping.category).toBeTruthy();
      expect(cfg.cadenceHours).toBeGreaterThan(0);
    }
  });
});
