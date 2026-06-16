import { describe, it, expect } from 'vitest';
import { parseHtml } from '../scripts/connectors/core/parse-html.js';
import { starterStrategies } from '../scripts/connectors/browser/starter.js';

const byId = (id: string) => starterStrategies.find((s) => s.id === id)!;

describe('starter strategies extract from static DOM', () => {
  it('tabelog: anchors by list-rst selector → path ids', () => {
    const html = `<ul>
      <li><a class="list-rst__rst-name-target" href="https://tabelog.com/en/kanagawa/A1401/rstLst/">Sushi One</a></li>
      <li><a class="list-rst__rst-name-target" href="https://tabelog.com/en/tokyo/A1301/">Ramen Two</a></li>
    </ul>`;
    const items = byId('tabelog').extract(parseHtml(html), 'https://tabelog.com/en/kanagawa/', 10);
    expect(items.map((i) => i.sourceId)).toEqual(['/en/kanagawa/A1401/rstLst', '/en/tokyo/A1301']);
    expect(items[0]!.name).toBe('Sushi One');
  });

  it('google-maps: feed anchors with aria-label name + place id', () => {
    const html = `<div role="feed">
      <a href="https://www.google.com/maps/place/?q=!19sChIJabc123!x" aria-label="Cafe Alpha">link</a>
    </div>`;
    const items = byId('google-maps').extract(parseHtml(html), 'https://www.google.com/maps/search/x', 10);
    expect(items[0]!.sourceId).toBe('ChIJabc123');
    expect(items[0]!.name).toBe('Cafe Alpha');
  });
});
