/** 匿名会话 guestKey：localStorage 持久化，随 chat 请求回传以防 IDOR */
const KEY = 'guest-key';

export function getGuestKey(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing && existing.length >= 16) return existing;
    const created =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 8)
        : `gk${Date.now().toString(36)}${Math.random().toString(36).slice(2, 14)}`;
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    return `gk${Date.now().toString(36)}fallback0001`;
  }
}

export function setGuestKey(key: string | undefined | null) {
  if (!key || key.length < 16) return;
  try {
    localStorage.setItem(KEY, key);
  } catch {
    /* ignore */
  }
}
