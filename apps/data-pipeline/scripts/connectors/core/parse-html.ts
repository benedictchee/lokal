import { parseHTML } from 'linkedom';

/**
 * Parse an HTML string into a DOM Document. The ONE isomorphic seam — linkedom
 * runs in both Node (the Playwright CLI) and workerd (the Worker extractor). If
 * linkedom ever fails under workerd, swap the parser HERE only.
 */
export function parseHtml(html: string): Document {
  return parseHTML(html).document as unknown as Document;
}
