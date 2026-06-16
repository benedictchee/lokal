import type { SourceConnector } from '../../scripts/connectors/core/types.js';
import type { ConnectorMapping } from '@travel/pipeline-core';
import { wikidata, dbpedia } from '../../scripts/connectors/tierA/sparql.js';
import { wikipedia, wikivoyage } from '../../scripts/connectors/tierA/mediawiki.js';
import { geonames } from '../../scripts/connectors/tierA/geonames.js';
import { socrataUs } from '../../scripts/connectors/tierA/gov-open.js';

export interface RefreshSourceConfig {
  connector: SourceConnector;
  mapping: ConnectorMapping; // { subject, category }
  cadenceHours: number;      // minimum hours between refreshes
}

/**
 * Open, keyless, fetch-based connectors registered into the refresh loop, keyed
 * by connector.id so the registry key always matches the id used for snapshot /
 * record state. Imported INDIVIDUALLY — never via core/registry.ts — so
 * Playwright (browser/strategies.ts) and DuckDB (open-bulk-s3.ts) never enter
 * the Worker bundle. subject/category are best-effort defaults (PulledRecord
 * carries neither). All cadence 24h for the first cut.
 */
export const REFRESH_SOURCES: Record<string, RefreshSourceConfig> = {
  [wikidata.id]:   { connector: wikidata,   mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [dbpedia.id]:    { connector: dbpedia,    mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [wikipedia.id]:  { connector: wikipedia,  mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [wikivoyage.id]: { connector: wikivoyage, mapping: { subject: 'poi', category: 'attraction' }, cadenceHours: 24 },
  [geonames.id]:   { connector: geonames,   mapping: { subject: 'poi', category: 'place' },      cadenceHours: 24 },
  [socrataUs.id]:  { connector: socrataUs,  mapping: { subject: 'poi', category: 'poi' },        cadenceHours: 24 },
};
