import { describe, it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchOverpass, type OverpassElement } from '../../src/fetchers/overpass.js';

const fixtureUrl = new URL('../fixtures/overpass-response.json', import.meta.url);
const fixtureText = await readFile(fileURLToPath(fixtureUrl), 'utf8');

function mockFetch(body: string, ok = true, status = 200): typeof fetch {
  return vi.fn(async () =>
    new Response(body, { status, headers: { 'content-type': 'application/json' } }),
  ) as unknown as typeof fetch;
}

const BBOX: [number, number, number, number] = [1.29, 103.79, 1.31, 103.81];

describe('fetchOverpass', () => {
  it('parses the Overpass envelope into OverpassElement[]', async () => {
    const fetchSpy = mockFetch(fixtureText);
    const els = await fetchOverpass({ bbox: BBOX }, { fetch: fetchSpy });

    expect(els).toHaveLength(3);
    const node = els.find((e) => e.id === 1001) as OverpassElement;
    expect(node.type).toBe('node');
    expect(node.lat).toBe(1.3);
    expect(node.lon).toBe(103.8);
    expect(node.tags.amenity).toBe('restaurant');

    const way = els.find((e) => e.id === 2002) as OverpassElement;
    expect(way.type).toBe('way');
    expect(way.center).toEqual({ lat: 1.301, lon: 103.801 });
    expect(way.tags['brand:wikidata']).toBe('Q5430873');

    const rel = els.find((e) => e.id === 3003) as OverpassElement;
    expect(rel.type).toBe('relation');
    expect(rel.tags.tourism).toBe('museum');
  });

  it('POSTs a QL query covering amenity, shop AND tourism with out center, bbox, and honest User-Agent', async () => {
    const fetchSpy = mockFetch(fixtureText);
    await fetchOverpass({ bbox: BBOX }, { fetch: fetchSpy });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchSpy as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(init.method).toBe('POST');

    const headers = new Headers(init.headers);
    expect(headers.get('User-Agent')).toBe('travel-data-pipeline/1.0 (+management@rushowl.app)');
    expect(headers.get('content-type')).toBe('application/x-www-form-urlencoded');

    const body = String(init.body);
    const ql = decodeURIComponent(body.replace(/^data=/, ''));
    expect(ql).toContain('[out:json]');
    expect(ql).toContain('nwr["amenity"]');
    expect(ql).toContain('nwr["shop"]');
    expect(ql).toContain('nwr["tourism"]');
    // bbox is south,west,north,east per Overpass QL
    expect(ql).toContain('(1.29,103.79,1.31,103.81)');
    expect(ql).toContain('out center');
  });

  it('throws on a non-OK HTTP response', async () => {
    const fetchSpy = mockFetch('rate limited', false, 429);
    await expect(fetchOverpass({ bbox: BBOX }, { fetch: fetchSpy })).rejects.toThrow(
      /Overpass request failed: 429/,
    );
  });
});
