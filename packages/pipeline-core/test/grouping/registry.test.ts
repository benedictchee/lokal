import { describe, it, expect } from 'vitest';
import { InMemoryGroupRegistry } from '../../src/grouping/registry.js';

const meta = (over = {}) => ({ subject: 'poi', kind: 'standalone', canonical_name: 'X', ...over });

describe('InMemoryGroupRegistry', () => {
  it('mints a UUIDv7 and returns it (version nibble === 7)', async () => {
    const reg = new InMemoryGroupRegistry();
    const id = await reg.resolve('standalone:abc', meta());
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is idempotent — same alias resolves to the same uuid across calls', async () => {
    const reg = new InMemoryGroupRegistry();
    const a = await reg.resolve('standalone:abc', meta());
    const b = await reg.resolve('standalone:abc', meta({ canonical_name: 'IGNORED' }));
    expect(a).toBe(b);
  });

  it('chain-merge — two outlets sharing a brand alias share one group', async () => {
    const reg = new InMemoryGroupRegistry();
    const a = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'Kopitiam' }));
    const b = await reg.resolve('brand:slug:kopitiam', meta({ kind: 'chain', canonical_name: 'Kopitiam' }));
    const c = await reg.resolve('brand:slug:old-town', meta({ kind: 'chain', canonical_name: 'Old Town' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('transport-category — all bus stations share one category group', async () => {
    const reg = new InMemoryGroupRegistry();
    const bus1 = await reg.resolve('transport:bus', meta({ subject: 'transport', kind: 'transport_category', canonical_name: 'bus' }));
    const bus2 = await reg.resolve('transport:bus', meta({ subject: 'transport', kind: 'transport_category', canonical_name: 'bus' }));
    const train = await reg.resolve('transport:train', meta({ subject: 'transport', kind: 'transport_category', canonical_name: 'train' }));
    expect(bus1).toBe(bus2);
    expect(bus1).not.toBe(train);
  });

  it('distinct aliases mint distinct uuids', async () => {
    const reg = new InMemoryGroupRegistry();
    const a = await reg.resolve('standalone:one', meta());
    const b = await reg.resolve('standalone:two', meta());
    expect(a).not.toBe(b);
  });
});
