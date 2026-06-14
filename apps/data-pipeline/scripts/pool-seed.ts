/**
 * Emit SQL to provision one pool device token and seed URLs.
 * Usage:
 *   tsx scripts/pool-seed.ts <deviceId> <rawToken> <url> [url...] > seed.sql
 *   wrangler d1 execute travel-groups --local --file=seed.sql
 *
 * The raw token is hashed with SHA-256; only the hash is stored. Print the raw
 * token to the operator once (stderr) so it can be pushed to the device via MDM.
 */
import { createHash } from 'node:crypto';

function sha256Hex(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function hostOf(u: string): string {
  return new URL(u).host;
}

const [deviceId, rawToken, ...urls] = process.argv.slice(2);
if (!deviceId || !rawToken || urls.length === 0) {
  console.error('usage: tsx scripts/pool-seed.ts <deviceId> <rawToken> <url> [url...]');
  process.exit(1);
}
const now = new Date().toISOString();
const lines: string[] = [];
lines.push(
  `INSERT OR REPLACE INTO pool_device (device_id, token_sha256, enabled, created_at) VALUES ('${deviceId}', '${sha256Hex(rawToken)}', 1, '${now}');`,
);
for (const u of urls) {
  lines.push(
    `INSERT OR IGNORE INTO pool_url_registry (url, host, enabled, consecutive_challenges) VALUES ('${u.replace(/'/g, "''")}', '${hostOf(u)}', 1, 0);`,
  );
}
console.error(`device token (push via MDM, store nowhere else): ${rawToken}`);
console.log(lines.join('\n'));
