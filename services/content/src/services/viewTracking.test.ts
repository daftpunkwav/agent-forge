import { describe, expect, it } from 'vitest';
import { createInMemoryViewDedup } from './viewTracking.js';

describe('viewTracking', () => {
  it('同一 key 在 TTL 内只计一次', () => {
    const store = createInMemoryViewDedup({ ttlMs: 60_000 });
    expect(store.shouldCount('u:1')).toBe(true);
    expect(store.shouldCount('u:1')).toBe(false);
    expect(store.shouldCount('u:2')).toBe(true);
  });
});
