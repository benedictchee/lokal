import { describe, it, expect } from 'vitest';
import { reviewFingerprint } from '../../src/reviews/fingerprint.js';

describe('reviewFingerprint', () => {
  it('is stable across case, punctuation, and whitespace variants', () => {
    const a = reviewFingerprint('Jane Doe', 'Great laksa!  Best in town.');
    const b = reviewFingerprint('jane   doe', 'great laksa best in town');
    expect(a).toBe(b);
  });
  it('differs when the text differs', () => {
    expect(reviewFingerprint('Jane', 'great laksa')).not.toBe(reviewFingerprint('Jane', 'terrible laksa'));
  });
  it('differs when the author differs (same text)', () => {
    expect(reviewFingerprint('Jane', 'great laksa')).not.toBe(reviewFingerprint('John', 'great laksa'));
  });
  it('returns 8 lowercase hex chars', () => {
    expect(reviewFingerprint('a', 'b')).toMatch(/^[0-9a-f]{8}$/);
  });
});
