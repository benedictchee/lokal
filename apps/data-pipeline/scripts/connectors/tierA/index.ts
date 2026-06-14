import type { SourceConnector } from '../core/types.js';
import { wikidata, dbpedia } from './sparql.js';
import { wikipedia, wikivoyage } from './mediawiki.js';
import { geonames } from './geonames.js';
import { osmOverpass, osmPlanet } from './osm.js';
import { foursquareOsPlaces, overture } from './open-bulk-s3.js';
import { socrataUs, datatourisme, opentripmap } from './gov-open.js';

export const tierAConnectors: SourceConnector[] = [
  foursquareOsPlaces,
  overture,
  osmOverpass,
  osmPlanet,
  wikidata,
  dbpedia,
  wikipedia,
  wikivoyage,
  geonames,
  socrataUs,
  datatourisme,
  opentripmap,
];
