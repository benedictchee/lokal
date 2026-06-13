import { describe, it, expect } from 'vitest';
import {
  EMPTY_CRITICAL_INFO,
  serializeCriticalInfo,
  criticalInfoEmbedText,
  buildExtractionMessages,
  parseCriticalInfo,
  type CriticalInfo,
} from '../../src/reviews/critical-info.js';

const ci: CriticalInfo = {
  specialties: ['double-roasted pork belly', 'zi char'],
  atmosphere: ['buzzy', 'cramped at peak'],
  good_for: ['groups'],
  consistent_praise: ['great value'],
  consistent_complaints: ['long queues'],
  practical: ['cash only'],
};

describe('serializeCriticalInfo', () => {
  it('is deterministic and includes facet content', () => {
    expect(serializeCriticalInfo(ci)).toBe(serializeCriticalInfo(ci));
    expect(serializeCriticalInfo(ci)).toContain('double-roasted pork belly');
  });
  it('omits empty facets entirely', () => {
    const out = serializeCriticalInfo({ ...EMPTY_CRITICAL_INFO, specialties: ['laksa'] });
    expect(out).toContain('laksa');
    expect(out.toLowerCase()).not.toContain('atmosphere');
  });
});

describe('criticalInfoEmbedText', () => {
  it('anchors with name and category', () => {
    const t = criticalInfoEmbedText('Tek Sen', 'Chinese restaurant', ci);
    expect(t).toContain('Tek Sen');
    expect(t).toContain('Chinese restaurant');
    expect(t).toContain('zi char');
  });
});

describe('buildExtractionMessages', () => {
  it('produces system+user messages mentioning the reviews and the JSON contract', () => {
    const msgs = buildExtractionMessages({
      name: 'Tek Sen', category: 'Chinese restaurant', rating: 4.5,
      reviews: [{ stars: 5, text: 'amazing pork belly' }],
    });
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('amazing pork belly');
    expect(msgs[0].content.toLowerCase()).toContain('json');
  });
});

describe('parseCriticalInfo', () => {
  it('parses a clean JSON object', () => {
    const out = parseCriticalInfo(JSON.stringify(ci));
    expect(out?.specialties).toContain('zi char');
  });
  it('strips ```json code fences', () => {
    const out = parseCriticalInfo('```json\n' + JSON.stringify(ci) + '\n```');
    expect(out?.good_for).toEqual(['groups']);
  });
  it('coerces missing facets to [] and caps array length', () => {
    const out = parseCriticalInfo(JSON.stringify({ specialties: Array(20).fill('x') }));
    expect(out?.atmosphere).toEqual([]);
    expect(out!.specialties.length).toBeLessThanOrEqual(8);
  });
  it('drops empty/whitespace strings', () => {
    const out = parseCriticalInfo(JSON.stringify({ specialties: ['  ', 'laksa', ''] }));
    expect(out?.specialties).toEqual(['laksa']);
  });
  it('returns null on non-JSON', () => {
    expect(parseCriticalInfo('the model refused to answer')).toBeNull();
  });
});
