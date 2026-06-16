import type { ConnectorMapping } from '@travel/pipeline-core';
import { starterStrategies } from '../../scripts/connectors/browser/starter.js';
import type { BrowserStrategy } from '../../scripts/connectors/core/browser-strategy.js';

export interface PilotSource {
  strategy: BrowserStrategy;
  mapping: ConnectorMapping;
}

const MAPPINGS: Record<string, ConnectorMapping> = {
  'google-maps': { subject: 'poi', category: 'poi' },
  tabelog: { subject: 'poi', category: 'restaurant' },
  wongnai: { subject: 'poi', category: 'restaurant' },
  '2gis': { subject: 'poi', category: 'poi' },
  yelp: { subject: 'poi', category: 'restaurant' },
  tripadvisor: { subject: 'poi', category: 'restaurant' },
  'atlas-obscura-web': { subject: 'poi', category: 'attraction' },
};

/** Pilot device-pool sources keyed by connector id (the pool_url_registry.source value). */
export const PILOT_SOURCES: Record<string, PilotSource> = Object.fromEntries(
  starterStrategies
    .filter((s) => MAPPINGS[s.id])
    .map((s) => [s.id, { strategy: s, mapping: MAPPINGS[s.id]! }]),
);
