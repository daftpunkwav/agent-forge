/**
 * 文章阅读量去重（进程内存级）。
 * 同一 viewerKey 在 TTL 内只计一次；多实例部署可替换为 Redis 实现。
 */
export interface ViewDedupStore {
  shouldCount(key: string): boolean;
}

export function createInMemoryViewDedup(opts?: {
  ttlMs?: number;
  maxEntries?: number;
}): ViewDedupStore {
  const ttlMs = opts?.ttlMs ?? 24 * 60 * 60 * 1000;
  const maxEntries = opts?.maxEntries ?? 10_000;
  const viewedCache = new Map<string, number>();

  return {
    shouldCount(key: string): boolean {
      const now = Date.now();
      const last = viewedCache.get(key);
      if (last && now - last < ttlMs) return false;
      viewedCache.set(key, now);
      if (viewedCache.size > maxEntries) {
        for (const [k, v] of viewedCache) {
          if (now - v > ttlMs) viewedCache.delete(k);
        }
      }
      return true;
    },
  };
}

/** 默认单例：同进程内各路由共享去重状态 */
let defaultStore: ViewDedupStore | null = null;

export function getDefaultViewDedup(): ViewDedupStore {
  if (!defaultStore) defaultStore = createInMemoryViewDedup();
  return defaultStore;
}

/** 测试用：注入或重置默认存储 */
export function setDefaultViewDedup(store: ViewDedupStore | null): void {
  defaultStore = store;
}
