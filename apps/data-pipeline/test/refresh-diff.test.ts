import { describe, it, expect } from 'vitest';
import { classifyRecords } from '../src/refresh/diff.js';

const rec = (uuid: string, hash: string) => ({ source_id: uuid, record_uuid: uuid, content_hash: hash });

describe('classifyRecords', () => {
  it('splits records into created / changed / unchanged by content_hash', () => {
    const prev = new Map([['a', 'h1'], ['b', 'h2']]); // a unchanged, b will change, c is new
    const pulled = [rec('a', 'h1'), rec('b', 'h2-new'), rec('c', 'h3')];
    const out = classifyRecords(pulled, prev);
    expect(out.created.map((r) => r.record_uuid)).toEqual(['c']);
    expect(out.changed.map((r) => r.record_uuid)).toEqual(['b']);
    expect(out.unchanged.map((r) => r.record_uuid)).toEqual(['a']);
  });

  it('treats everything as created when there is no prior state', () => {
    const out = classifyRecords([rec('x', 'h')], new Map());
    expect(out.created.length).toBe(1);
    expect(out.changed.length).toBe(0);
  });
});
