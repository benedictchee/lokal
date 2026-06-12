import { v7 as uuidv7 } from 'uuid';

/** Metadata captured the first time an alias mints a group (groups table row). */
export interface GroupMeta {
  subject: string;
  kind: string;
  canonical_name: string;
}

/**
 * Program-owned group identity registry. resolve() reuses the existing
 * group_uuid for a known alias, otherwise mints a fresh UUIDv7 (D9 — the
 * minted uuid is the identity; the alias is only a match signal). Idempotent.
 */
export interface GroupRegistry {
  resolve(aliasKey: string, meta: GroupMeta): Promise<string>;
}

/** In-memory impl for the CLI and unit tests; mints exactly one uuidv7 per alias. */
export class InMemoryGroupRegistry implements GroupRegistry {
  private readonly aliases = new Map<string, string>(); // alias_key -> group_uuid
  private readonly groups = new Map<string, GroupMeta>(); // group_uuid -> meta

  async resolve(aliasKey: string, meta: GroupMeta): Promise<string> {
    const existing = this.aliases.get(aliasKey);
    if (existing) return existing;
    const group_uuid = uuidv7(); // program-minted — NOT derived from any external id
    this.aliases.set(aliasKey, group_uuid);
    this.groups.set(group_uuid, meta);
    return group_uuid;
  }
}
