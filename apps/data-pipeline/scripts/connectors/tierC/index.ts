import type { SourceConnector } from '../core/types.js';
import { tierCGlobalConnectors } from './global-maps.js';
import { tierCAsiaConnectors } from './asia-maps.js';

export const tierCConnectors: SourceConnector[] = [
  ...tierCGlobalConnectors,
  ...tierCAsiaConnectors,
];
