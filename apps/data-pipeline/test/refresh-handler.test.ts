import { describe, it, expect } from 'vitest';
import worker from '../src/index.js';

const baseEnv = {
  INGEST_TOKEN: 'secret-token',
} as any;

describe('POST /refresh auth', () => {
  it('401s without a valid bearer token', async () => {
    const res = await worker.fetch(new Request('https://x/refresh', { method: 'POST', body: '{}' }), baseEnv);
    expect(res.status).toBe(401);
  });

  it('400s on an unknown source', async () => {
    const res = await worker.fetch(
      new Request('https://x/refresh', {
        method: 'POST',
        headers: { Authorization: 'Bearer secret-token', 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'not-a-real-connector' }),
      }),
      baseEnv,
    );
    expect(res.status).toBe(400);
  });
});
