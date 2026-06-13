import type { SourceConnector } from '../core/types.js';
import { tierDOtaConnectors } from './ota.js';
import { tierDCnKrConnectors } from './cn-kr-merchant.js';
import { tierDTourismConnectors } from './tourism-partner.js';

export const tierDConnectors: SourceConnector[] = [
  ...tierDOtaConnectors,
  ...tierDCnKrConnectors,
  ...tierDTourismConnectors,
];
