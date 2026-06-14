import { describe, it, expect } from 'vitest';
import { sha256Hex } from '../src/pool/crypto.js';

describe('sha256Hex', () => {
  it('hashes the empty string to the known SHA-256 digest', async () => {
    expect(await sha256Hex('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });
  it('is stable and lowercase-hex of length 64', async () => {
    const h = await sha256Hex('device-token-abc');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex('device-token-abc')).toBe(h);
  });
});
