import { describe, it, expect, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { D1GroupRegistry } from '../src/registry-d1.js';

// Migration SQL — keeps the split-on-semicolon logic identical to production.
// We inline here because Miniflare's virtual FS doesn't map to the host filesystem.
const MIGRATION_SQL = `
CREATE TABLE IF NOT EXISTS groups (
  group_uuid     TEXT PRIMARY KEY,
  subject        TEXT NOT NULL,
  kind           TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS group_aliases (
  alias_key  TEXT PRIMARY KEY,
  group_uuid TEXT NOT NULL,
  FOREIGN KEY (group_uuid) REFERENCES groups(group_uuid)
);

CREATE INDEX IF NOT EXISTS idx_group_aliases_group ON group_aliases(group_uuid)
`;

// Apply the migration once per test against the isolated-per-test D1 (env.GROUPS).
async function applyMigration() {
  for (const stmt of MIGRATION_SQL.split(';').map((s) => s.trim()).filter(Boolean)) {
    await env.GROUPS.prepare(stmt).run();
  }
}

const meta = (over = {}) => ({ subject: 'poi', kind: 'standalone', canonical_name: 'X', ...over });

describe('D1GroupRegistry', () => {
  beforeEach(async () => {
    await applyMigration();
  });

  it('mints a UUIDv7 and persists groups + group_aliases rows', async () => {
    const reg = new D1GroupRegistry(env.GROUPS);
    const id = await reg.resolve('standalone:abc', meta({ canonical_name: 'Tek Sen' }));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const alias = await env.GROUPS.prepare('SELECT group_uuid FROM group_aliases WHERE alias_key = ?')
      .bind('standalone:abc')
      .first<{ group_uuid: string }>();
    expect(alias?.group_uuid).toBe(id);

    const group = await env.GROUPS.prepare('SELECT canonical_name, kind FROM groups WHERE group_uuid = ?')
      .bind(id)
      .first<{ canonical_name: string; kind: string }>();
    expect(group).toEqual({ canonical_name: 'Tek Sen', kind: 'standalone' });
  });

  it('repeated resolve of the same alias returns the same uuid (idempotent)', async () => {
    const reg = new D1GroupRegistry(env.GROUPS);
    const a = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'Kopitiam' }));
    const b = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'IGNORED' }));
    expect(a).toBe(b);

    const rows = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM groups').first<{ n: number }>();
    expect(rows?.n).toBe(1); // INSERT OR IGNORE — no duplicate group row
  });

  it('concurrent resolves of the same NEW alias converge on one group (race-safe)', async () => {
    const reg = new D1GroupRegistry(env.GROUPS);
    const [a, b, c] = await Promise.all([
      reg.resolve('brand:slug:raced', meta({ kind: 'chain', canonical_name: 'Raced' })),
      reg.resolve('brand:slug:raced', meta({ kind: 'chain', canonical_name: 'Raced' })),
      reg.resolve('brand:slug:raced', meta({ kind: 'chain', canonical_name: 'Raced' })),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    const aliasRows = await env.GROUPS.prepare('SELECT COUNT(*) AS n FROM group_aliases WHERE alias_key = ?')
      .bind('brand:slug:raced')
      .first<{ n: number }>();
    expect(aliasRows?.n).toBe(1);
  });

  it('distinct aliases mint distinct uuids', async () => {
    const reg = new D1GroupRegistry(env.GROUPS);
    const a = await reg.resolve('standalone:one', meta());
    const b = await reg.resolve('standalone:two', meta());
    expect(a).not.toBe(b);
  });
});
