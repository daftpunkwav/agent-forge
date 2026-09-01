import { describe, expect, it } from 'vitest';
import { createTtlCache } from './userContextCache.js';

describe('userContextCache', () => {
  it('TTL 过期后 get 返回 undefined', () => {
    const cache = createTtlCache<string>({ ttlMs: 10, maxEntries: 10 });
    cache.set('a', 'v');
    expect(cache.get('a')).toBe('v');
  });

  it('deleteByPrefix 按用户前缀失效', () => {
    const cache = createTtlCache<number>({ ttlMs: 60_000, maxEntries: 10 });
    cache.set('u1::/a', 1);
    cache.set('u1::/b', 2);
    cache.set('u2::/a', 3);
    cache.deleteByPrefix('u1::');
    expect(cache.get('u1::/a')).toBeUndefined();
    expect(cache.get('u2::/a')).toBe(3);
  });
});
