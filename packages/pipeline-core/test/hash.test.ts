import { describe, it, expect } from 'vitest';
import { fnv1a } from '../src/hash.js';

describe('fnv1a (32-bit FNV-1a, lowercase hex)', () => {
  it('matches canonical 32-bit FNV-1a vectors', () => {
    // Canonical FNV-1a 32-bit hashes, rendered as 8-char zero-padded hex.
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(fnv1a('foobar')).toBe('bf9cf968');
    expect(fnv1a('hello')).toBe('4f9f2cab');
  });

  it('always returns 8 lowercase hex chars (zero-padded)', () => {
    for (const s of ['', 'a', 'foobar', 'hello', 'Gurney Drive', 'x'.repeat(1000)]) {
      const h = fnv1a(s);
      expect(h).toMatch(/^[0-9a-f]{8}$/);
    }
  });

  it('is deterministic across repeated calls', () => {
    const sample = 'Gurney Drive Hawker5.4157621100.3318078osmnode/123';
    expect(fnv1a(sample)).toBe(fnv1a(sample));
    expect(fnv1a(sample)).toBe('3d01d515');
  });

  it('is sensitive to input (no trivial collisions on close strings)', () => {
    expect(fnv1a('abc')).not.toBe(fnv1a('abd'));
    expect(fnv1a('ab')).not.toBe(fnv1a('ba'));
  });
});
