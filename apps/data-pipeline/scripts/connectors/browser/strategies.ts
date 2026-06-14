/**
 * Browser-scrape connector aggregator.
 *
 * Combines the hand-verified `starterStrategies` with the generated per-cluster
 * strategy modules, then maps each BrowserStrategy → SourceConnector. Run with
 * `tsx scripts/connectors/run.ts <all|id> --browser` (one page/visit, human-paced).
 *
 * Generated imports are inserted below by _gen/browser-assemble.mjs.
 */
import { defineBrowserConnector, type BrowserStrategy } from '../core/browser-connector.js';
import { starterStrategies } from './starter.js';
import { browserMapsApis } from './maps-apis.js';
import { browserLicensable } from './licensable.js';
import { browserOta } from './ota.js';
import { browserCnKr } from './cn-kr.js';
import { browserAsiaCommunity } from './asia-community.js';
import { browserGlobalCommunity } from './global-community.js';
import { browserRussiaMena } from './russia-mena.js';

const ALL_STRATEGIES: BrowserStrategy[] = [
  ...starterStrategies,
  ...browserMapsApis,
  ...browserLicensable,
  ...browserOta,
  ...browserCnKr,
  ...browserAsiaCommunity,
  ...browserGlobalCommunity,
  ...browserRussiaMena,
];

export const browserConnectors = ALL_STRATEGIES.map(defineBrowserConnector);
