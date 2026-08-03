/** 与 api.ts 共享 token 读写，避免循环依赖 */

const ACCESS_KEY = 'agentforge-token';
const REFRESH_KEY = 'agentforge-refresh-token';

export function getToken(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(ACCESS_KEY, token);
  else localStorage.removeItem(ACCESS_KEY);
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setRefreshToken(token: string | null) {
  if (token) localStorage.setItem(REFRESH_KEY, token);
  else localStorage.removeItem(REFRESH_KEY);
}

/** 同时写入或清空 access + refresh */
export function setTokens(access: string | null, refresh?: string | null) {
  setToken(access);
  if (refresh !== undefined) setRefreshToken(refresh);
}

export function clearTokens() {
  setToken(null);
  setRefreshToken(null);
}
