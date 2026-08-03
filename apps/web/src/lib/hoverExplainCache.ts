/**
 * 行内 / 对话框悬停讲解共用 L1 缓存
 * TTL 20min · LRU 64 · 仅完整且安全的讲解（拒绝思考轨迹 / 改稿过程）
 *
 * 清洗逻辑已统一迁移至 @agentforge/shared，此文件只保留缓存存储与 key 逻辑。
 */

import {
  isSafeHoverDisplay,
  stripSelfRevisionClient,
  sanitizeHoverDisplay,
  looksLikeHoverPlanning,
  isCompleteHoverAnswer,
  isLikelyHoverTeachingClient,
} from '@agentforge/shared';

// 重新导出供组件直接使用（保持现有 import 路径兼容）
export {
  isSafeHoverDisplay,
  stripSelfRevisionClient,
  sanitizeHoverDisplay,
  looksLikeHoverPlanning,
  isCompleteHoverAnswer,
  isLikelyHoverTeachingClient,
};

// ─── L1 内存缓存 ──────────────────────────────────────────────────────────────

type Entry = { text: string; at: number };

const TTL_MS = 20 * 60 * 1000;
const MAX = 64;
const store = new Map<string, Entry>();

/** 与 AgentFloat 等监听者同步清空内存缓存 */
export const AGENT_CACHE_CLEARED_EVENT = 'agentforge:agent-cache-cleared';

/** 清空浏览器端 L1 悬停缓存，并广播事件供气泡组件清空各自 Map */
export function clearAllHoverCaches(): number {
  const n = store.size;
  store.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AGENT_CACHE_CLEARED_EVENT, { detail: { clearedL1: n } }),
    );
  }
  return n;
}

/**
 * L1 缓存 key（明文 style::topic，进程内 Map 查找用）。
 * 与后端 L2 key（sha256 版本化 hash）不同——两端独立查询，无需一致；
 * L1 不版本化，随 L2 升级自然失效。
 */
export function hoverCacheKey(topic: string, style = 'professional'): string {
  return `${style}::${topic.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400)}`;
}

export function readHoverCache(key: string): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  // 脏缓存（思考/改稿）直接丢弃
  if (!isSafeHoverDisplay(hit.text)) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, { text: hit.text, at: Date.now() });
  return hit.text;
}

export function writeHoverCache(key: string, text: string) {
  if (!isSafeHoverDisplay(text)) return;
  if (store.has(key)) store.delete(key);
  store.set(key, { text, at: Date.now() });
  while (store.size > MAX) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
    else break;
  }
}

/** @alias isSafeHoverDisplay — 便于 readHoverCache 内部复用语义一致的名称 */
export function isCompleteHoverText(s: string): boolean {
  return isSafeHoverDisplay(s);
}
