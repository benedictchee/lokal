import type { Env } from '../env.js';
import { PoolDeviceStore } from './pool-d1.js';
import { sha256Hex } from './crypto.js';

export type PoolEnv = Pick<Env, 'GROUPS' | 'DATA'> & {
  EXTRACT: { send(msg: { r2Key: string; url: string; source: string }): Promise<unknown> };
};

/**
 * Resolve a request's `Authorization: Bearer <token>` to a deviceId, or null.
 * Tokens are matched by SHA-256 hash lookup (the raw token is never stored), so a
 * single indexed query both authenticates and identifies the device.
 */
export async function authenticateDevice(request: Request, env: PoolEnv): Promise<string | null> {
  const header = request.headers.get('Authorization') ?? '';
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return null;
  const token = header.slice(prefix.length);
  if (!token) return null;
  const device = await new PoolDeviceStore(env.GROUPS).findByTokenHash(await sha256Hex(token));
  return device?.device_id ?? null;
}
