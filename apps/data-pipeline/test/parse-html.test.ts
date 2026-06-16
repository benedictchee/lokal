import { describe, it, expect } from 'vitest';
import { parseHtml } from '../scripts/connectors/core/parse-html.js';
import { anchors } from '../scripts/connectors/core/browser-strategy.js';

// Fixture ordering is load-bearing for the regression tests below:
//   line 1: a.x with a non-empty href but EMPTY name  -> invalid, appears FIRST
//   line 2: valid a.x (/a/1)
//   line 3: valid a.x (https host /a/2)
//   line 4: a.y                                        -> excluded by selector
//   line 5: a.x with a malformed href (unresolvable)   -> must be dropped, not throw
const HTML = `<html><body>
  <a class="x" href="/icon"></a>
  <a class="x" href="/a/1">  First  Place </a>
  <a class="x" href="https://h.com/a/2">Second</a>
  <a class="y" href="/a/3">Ignored</a>
  <a class="x" href="http://%">Bad</a>
</body></html>`;

describe('parseHtml + anchors', () => {
  it('parses HTML and extracts matching anchors with absolute urls', () => {
    const doc = parseHtml(HTML);
    const items = anchors(doc, 'https://base.com/list', 'a.x', (href) => href.replace(/^https?:\/\/[^/]+/, ''), 10);
    expect(items.map((i) => ({ id: i.sourceId, name: i.name, url: i.url }))).toEqual([
      { id: '/a/1', name: 'First Place', url: 'https://base.com/a/1' },
      { id: '/a/2', name: 'Second', url: 'https://h.com/a/2' },
    ]); // a.y excluded by selector; empty-name a.x/icon and malformed a.x dropped
  });

  it('filters invalid anchors BEFORE applying the limit (parity with old extractor)', () => {
    // The empty-name a.x/icon is the FIRST matching element. With limit=2, a
    // slice-before-filter implementation would slice [icon, /a/1], then drop the
    // icon, yielding only [/a/1]. Filtering first must instead yield both valid
    // items. Asserting exactly [/a/1, /a/2] fails under the old slice-first order.
    const doc = parseHtml(HTML);
    const items = anchors(doc, 'https://base.com/list', 'a.x', (href) => href.replace(/^https?:\/\/[^/]+/, ''), 2);
    expect(items.map((i) => i.sourceId)).toEqual(['/a/1', '/a/2']);
  });

  it('drops anchors with an unresolvable href instead of throwing', () => {
    // http://% throws from new URL(raw, baseUrl). Without the try/catch in
    // anchors() this call would throw; with it, the bad anchor is filtered out
    // (empty sourceId/url) and the valid items remain.
    const doc = parseHtml(HTML);
    const items = anchors(doc, 'https://base.com/list', 'a.x', (href) => href.replace(/^https?:\/\/[^/]+/, ''), 10);
    expect(items.some((i) => i.name === 'Bad')).toBe(false);
    expect(items.map((i) => i.sourceId)).toEqual(['/a/1', '/a/2']);
  });

  it('respects the limit', () => {
    const doc = parseHtml(HTML);
    expect(anchors(doc, 'https://base.com/', 'a.x', (h) => h, 1).length).toBe(1);
  });
});
