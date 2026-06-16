import { describe, it, expect } from 'vitest';
import { parseHtml } from '../scripts/connectors/core/parse-html.js';
import { anchors } from '../scripts/connectors/core/browser-strategy.js';

const HTML = `<html><body>
  <a class="x" href="/a/1">  First  Place </a>
  <a class="x" href="https://h.com/a/2">Second</a>
  <a class="y" href="/a/3">Ignored</a>
  <a class="x" href="/a/4"></a>
</body></html>`;

describe('parseHtml + anchors', () => {
  it('parses HTML and extracts matching anchors with absolute urls', () => {
    const doc = parseHtml(HTML);
    const items = anchors(doc, 'https://base.com/list', 'a.x', (href) => href.replace(/^https?:\/\/[^/]+/, ''), 10);
    expect(items.map((i) => ({ id: i.sourceId, name: i.name, url: i.url }))).toEqual([
      { id: '/a/1', name: 'First Place', url: 'https://base.com/a/1' },
      { id: '/a/2', name: 'Second', url: 'https://h.com/a/2' },
    ]); // a.y excluded by selector; empty-name a.x/4 filtered out
  });

  it('respects the limit', () => {
    const doc = parseHtml(HTML);
    expect(anchors(doc, 'https://base.com/', 'a.x', (h) => h, 1).length).toBe(1);
  });
});
