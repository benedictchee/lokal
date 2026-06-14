import type { SourceConnector } from '../core/types.js';
import { atlasObscura } from './atlas-obscura.js';
import { tierECnConnectors } from './cn-community.js';
import { tierEAsiaConnectors } from './asia-community.js';
import { tierEGlobalConnectors } from './global-community.js';
import { russiaMenaConnectors } from './russia-mena.js';

export const tierEConnectors: SourceConnector[] = [
  atlasObscura,
  ...tierECnConnectors,
  ...tierEAsiaConnectors,
  ...tierEGlobalConnectors,
  ...russiaMenaConnectors,
];
