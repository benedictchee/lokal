import { describe, it, expect } from 'vitest';
import { extractCriticalInfo } from '../src/extract-critical-info.js';

const input = {
  name: 'Tek Sen', category: 'Chinese restaurant', rating: 4.5,
  reviews: [{ stars: 5, text: 'pork belly amazing' }, { stars: 5, text: 'great pork belly, long queue' }],
};

describe('extractCriticalInfo', () => {
  it('parses a good JSON response', async () => {
    const ai = { run: async () => ({ response: '{"specialties":["pork belly"]}' }) };
    const ci = await extractCriticalInfo(ai as any, input);
    expect(ci?.specialties).toEqual(['pork belly']);
  });
  it('retries once on unparseable output, then succeeds', async () => {
    let n = 0;
    const ai = { run: async () => { n++; return { response: n === 1 ? 'sorry' : '{"good_for":["groups"]}' }; } };
    const ci = await extractCriticalInfo(ai as any, input);
    expect(n).toBe(2);
    expect(ci?.good_for).toEqual(['groups']);
  });
  it('returns null if it never parses', async () => {
    const ai = { run: async () => ({ response: 'no json here' }) };
    expect(await extractCriticalInfo(ai as any, input)).toBeNull();
  });
});
