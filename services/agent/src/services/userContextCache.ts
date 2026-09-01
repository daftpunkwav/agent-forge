/** Agent 用户上下文短缓存（进程内 TTL Map，可注入/重置便于测试与多实例演进） */
export interface TtlCache<V> {
  get(key: string): V | undefined;
  set(key: string, value: V, at?: number): void;
  deleteByPrefix(prefix: string): void;
  clear(): void;
}

export function createTtlCache<V>(opts: { ttlMs: number; maxEntries: number }): TtlCache<V> {
  const store = new Map<string, { at: number; value: V }>();
  const { ttlMs, maxEntries } = opts;

  return {
    get(key: string): V | undefined {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (Date.now() - hit.at >= ttlMs) {
        store.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: V, at = Date.now()) {
      store.set(key, { at, value });
      if (store.size > maxEntries) {
        const oldest = store.keys().next();
        if (!oldest.done) store.delete(oldest.value);
      }
    },
    deleteByPrefix(prefix: string) {
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) store.delete(k);
      }
    },
    clear() {
      store.clear();
    },
  };
}

let defaultUserContextCache: TtlCache<unknown> | null = null;

export function getDefaultUserContextCache<V>(): TtlCache<V> {
  if (!defaultUserContextCache) {
    defaultUserContextCache = createTtlCache<V>({ ttlMs: 60_000, maxEntries: 5000 });
  }
  return defaultUserContextCache as TtlCache<V>;
}

export function setDefaultUserContextCache<V>(cache: TtlCache<V> | null): void {
  defaultUserContextCache = cache;
}
