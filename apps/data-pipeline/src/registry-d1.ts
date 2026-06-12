import { v7 as uuidv7 } from 'uuid';
import type { GroupRegistry, GroupMeta } from '@travel/pipeline-core';

/**
 * D1-backed group registry. resolve():
 *   1. Read group_aliases by alias_key — reuse on hit.
 *   2. On miss, mint a UUIDv7 and INSERT OR IGNORE both rows (idempotent under
 *      retry; race-safe — a concurrent writer's row survives, ours is ignored).
 *   3. Re-read the alias to return the WINNING group_uuid (ours or the racer's).
 */
export class D1GroupRegistry implements GroupRegistry {
  constructor(private readonly db: D1Database) {}

  async resolve(aliasKey: string, meta: GroupMeta): Promise<string> {
    const existing = await this.db
      .prepare('SELECT group_uuid FROM group_aliases WHERE alias_key = ?')
      .bind(aliasKey)
      .first<{ group_uuid: string }>();
    if (existing) return existing.group_uuid;

    const group_uuid = uuidv7(); // program-minted — NOT derived from any external id
    const created_at = Date.now();

    await this.db.batch([
      this.db
        .prepare(
          'INSERT OR IGNORE INTO groups (group_uuid, subject, kind, canonical_name, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(group_uuid, meta.subject, meta.kind, meta.canonical_name, created_at),
      this.db
        .prepare('INSERT OR IGNORE INTO group_aliases (alias_key, group_uuid) VALUES (?, ?)')
        .bind(aliasKey, group_uuid),
    ]);

    // Re-read: if a concurrent writer won the alias INSERT, return THEIR uuid.
    const winner = await this.db
      .prepare('SELECT group_uuid FROM group_aliases WHERE alias_key = ?')
      .bind(aliasKey)
      .first<{ group_uuid: string }>();
    return winner!.group_uuid;
  }
}
