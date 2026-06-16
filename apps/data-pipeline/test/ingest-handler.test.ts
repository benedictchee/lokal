import { describe, it, expect, vi } from 'vitest';
import handler from '../src/index.js';
import type { Env } from '../src/env.js';

/** Build a minimal mock Env for the fetch handler. */
function makeEnv(token?: string): Env {
  return {
    DATA: {} as Env['DATA'],
    GROUPS: {} as Env['GROUPS'],
    ENRICH: {} as Env['ENRICH'],
    EXTRACT: {} as Env['EXTRACT'],
    VECTORIZE: {} as Env['VECTORIZE'],
    AI: {} as Env['AI'],
    INGEST: {
      create: vi.fn(async () => ({ id: 'wf-test-id' })),
    } as unknown as Env['INGEST'],
    DATA_VERSION: '1',
    INGEST_TOKEN: token,
  };
}

/** Make a POST /ingest request with the given headers and body. */
function ingestRequest(body: unknown, authHeader?: string): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authHeader !== undefined) headers['Authorization'] = authHeader;
  return new Request('http://localhost/ingest', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const VALID_BODY = {
  source: 'osm',
  region: 'penang',
  bbox: [5.2, 100.2, 5.5, 100.5],
  dataVersion: 1,
};

describe('POST /ingest — auth', () => {
  it('returns 401 when INGEST_TOKEN is unset', async () => {
    const env = makeEnv(undefined);
    const res = await handler.fetch(ingestRequest(VALID_BODY, 'Bearer secret'), env);
    expect(res.status).toBe(401);
    expect(env.INGEST.create).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest(VALID_BODY, undefined), env);
    expect(res.status).toBe(401);
    expect(env.INGEST.create).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest(VALID_BODY, 'Token secret'), env);
    expect(res.status).toBe(401);
    expect(env.INGEST.create).not.toHaveBeenCalled();
  });

  it('returns 401 when token is wrong', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest(VALID_BODY, 'Bearer wrong'), env);
    expect(res.status).toBe(401);
    expect(env.INGEST.create).not.toHaveBeenCalled();
  });

  it('returns 202 with correct token and valid body', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest(VALID_BODY, 'Bearer secret'), env);
    expect(res.status).toBe(202);
    expect(env.INGEST.create).toHaveBeenCalledOnce();
    const json = await res.json() as { id: string; params: unknown };
    expect(json.id).toBe('wf-test-id');
  });
});

describe('POST /ingest — bbox validation', () => {
  const auth = 'Bearer secret';

  it('returns 400 when bbox is missing', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ region: 'penang', dataVersion: 1 }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when bbox has fewer than 4 elements', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, bbox: [5.2, 100.2, 5.5] }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when bbox contains a non-finite number (NaN)', async () => {
    const env = makeEnv('secret');
    const body = { ...VALID_BODY, bbox: [5.2, 100.2, NaN, 100.5] };
    const res = await handler.fetch(ingestRequest(body, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when bbox contains Infinity', async () => {
    const env = makeEnv('secret');
    // Infinity serialises as null in JSON, which is not a number → caught by typeof check
    const body = { ...VALID_BODY, bbox: [5.2, 100.2, 5.5, null] };
    const res = await handler.fetch(ingestRequest(body, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when lat out of range (s < -90)', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, bbox: [-91, 100.2, 5.5, 100.5] }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when lat out of range (n > 90)', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, bbox: [5.2, 100.2, 91, 100.5] }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when inverted south > north', async () => {
    const env = makeEnv('secret');
    // Wrong order: [lon, lat, lon, lat] — this is the old buggy Penang value
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, bbox: [100.0, 5.2, 100.6, 5.6] }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when inverted west > east', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, bbox: [5.2, 100.5, 5.5, 100.2] }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 when lon out of range (e > 180)', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, bbox: [5.2, 100.2, 5.5, 181] }, auth), env);
    expect(res.status).toBe(400);
  });
});

describe('POST /ingest — region / source validation', () => {
  const auth = 'Bearer secret';

  it('returns 400 for region with path traversal characters', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, region: '../etc' }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for region that is empty string', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, region: '' }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for region longer than 32 chars', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, region: 'a'.repeat(33) }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid source string', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, source: 'bad source!' }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 202 when source is omitted (defaults to osm)', async () => {
    const env = makeEnv('secret');
    const { source: _source, ...noSource } = VALID_BODY;
    const res = await handler.fetch(ingestRequest(noSource, auth), env);
    expect(res.status).toBe(202);
  });
});

describe('POST /ingest — dataVersion validation', () => {
  const auth = 'Bearer secret';

  it('returns 400 for negative dataVersion', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, dataVersion: -1 }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for dataVersion >= 1e9', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, dataVersion: 1e9 }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer dataVersion', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, dataVersion: 1.5 }, auth), env);
    expect(res.status).toBe(400);
  });

  it('returns 202 for dataVersion 0', async () => {
    const env = makeEnv('secret');
    const res = await handler.fetch(ingestRequest({ ...VALID_BODY, dataVersion: 0 }, auth), env);
    expect(res.status).toBe(202);
  });
});
