import { parseHTML } from 'linkedom';

/**
 * The document type linkedom returns — derived from its own return type so we
 * never depend on the global lib.dom `Document` (unavailable under the Worker's
 * tsconfig, which restricts lib/types to ES2023 + workers-types).
 */
export type ParsedDocument = ReturnType<typeof parseHTML>['document'];

/**
 * Parse an HTML string into a DOM Document. The ONE isomorphic seam — linkedom
 * runs in both Node (the Playwright CLI) and workerd (the Worker extractor). If
 * linkedom ever fails under workerd, swap the parser HERE only.
 */
export function parseHtml(html: string): ParsedDocument {
  return parseHTML(html).document;
}
