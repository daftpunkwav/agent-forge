/**
 * 行内 / 对话框悬停讲解共用 L1 缓存
 * TTL 20min · LRU 64 · 仅完整答案
 */

type Entry = { text: string; at: number };

const TTL_MS = 20 * 60 * 1000;
const MAX = 64;
const store = new Map<string, Entry>();

function looksLikePlanning(s: string): boolean {
  return /思考过程|写作计划|我需要：|结构如下|###\s*Thought|推理过程|内部思考|讲解失败|暂无讲解/i.test(
    (s || '').trim().slice(0, 120),
  );
}

function isComplete(s: string): boolean {
  const t = (s || '').trim();
  if (t.length < 12 || t.length > 900) return false;
  if (looksLikePlanning(t)) return false;
  if (/[，、：:与和或及]$/.test(t)) return false;
  return true;
}

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
  if (!isComplete(hit.text)) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, { text: hit.text, at: Date.now() });
  return hit.text;
}

export function writeHoverCache(key: string, text: string) {
  if (!isComplete(text)) return;
  if (store.has(key)) store.delete(key);
  store.set(key, { text, at: Date.now() });
  while (store.size > MAX) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
    else break;
  }
}

export function isCompleteHoverText(s: string): boolean {
  return isComplete(s);
}

export function looksLikeHoverPlanning(s: string): boolean {
  return looksLikePlanning(s);
}

/** 展示用：尽量抢救可用讲解，避免空白「暂无讲解」 */
export function sanitizeHoverDisplay(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  if (!looksLikePlanning(s)) return s.slice(0, 600);
  const parts = s.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const last = [...parts].reverse().find((p) => p.length >= 12 && !looksLikePlanning(p));
  return (last || '').slice(0, 600);
}
