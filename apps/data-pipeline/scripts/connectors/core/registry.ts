/**
 * Connector registry — the single list the runner selects from.
 * Each tier contributes an array; adding a connector = add its file + one line
 * to that tier's index.ts.
 */
import type { SourceConnector } from './types.js';
import { tierAConnectors } from '../tierA/index.js';
import { tierBConnectors } from '../tierB/index.js';
import { tierCConnectors } from '../tierC/index.js';
import { tierDConnectors } from '../tierD/index.js';
import { tierEConnectors } from '../tierE/index.js';
import { browserConnectors } from '../browser/strategies.js';

/** API / data connectors (default registry). */
export const ALL_CONNECTORS: SourceConnector[] = [
  ...tierAConnectors,
  ...tierBConnectors,
  ...tierCConnectors,
  ...tierDConnectors,
  ...tierEConnectors,
];

/** Browser-scrape connectors (run with `--browser`, one page/visit, human-paced). */
export const BROWSER_CONNECTORS: SourceConnector[] = [...browserConnectors];

export function selectFrom(pool: SourceConnector[], selector: string): SourceConnector[] {
  const s = selector.trim();
  if (s === 'all') return pool;
  if (/^tier[A-E]$/i.test(s)) {
    const tier = s.slice(-1).toUpperCase();
    return pool.filter((c) => c.tier === tier);
  }
  const ids = new Set(s.split(',').map((x) => x.trim()));
  return pool.filter((c) => ids.has(c.id));
}

export function selectConnectors(selector: string): SourceConnector[] {
  return selectFrom(ALL_CONNECTORS, selector);
}
