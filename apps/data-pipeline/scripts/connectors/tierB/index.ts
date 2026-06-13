import type { SourceConnector } from '../core/types.js';
import { licensableConnectors } from './licensable.js';

export const tierBConnectors: SourceConnector[] = [
  ...licensableConnectors,
];
