import {
  clearTokens,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
  setTokens,
} from '../apiToken';

export const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export { setToken, getToken, getRefreshToken, setRefreshToken, setTokens, clearTokens };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 普通 API 请求默认超时（SSE 流走 agentStream.ts 的 28s 独立超时） */
const REQUEST_TIMEOUT_MS = 15_000;

/** 单飞：并发 401 只触发一次 refresh */
let refreshInFlight: Promise<boolean> | null = null;

async function tryRefreshAccessToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${BASE}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        const data = (await res.json().catch(() => ({}))) as Partial<{
          accessToken: string;
          refreshToken: string;
        }>;
        if (!res.ok || !data.accessToken || !data.refreshToken) {
          clearTokens();
          return false;
        }
        setTokens(data.accessToken, data.refreshToken);
        return true;
      } catch {
        clearTokens();
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  if (init.signal) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers, signal: controller.signal });
    const data = res.status === 204 ? {} : await res.json().catch(() => ({}));

    if (
      res.status === 401 &&
      !retried &&
      !path.startsWith('/auth/refresh') &&
      !path.startsWith('/auth/logout') &&
      !path.startsWith('/auth/login') &&
      !path.startsWith('/auth/register')
    ) {
      const ok = await tryRefreshAccessToken();
      if (ok) {
        return request<T>(path, init, true);
      }
    }

    if (!res.ok) {
      throw new ApiError(
        res.status,
        data?.error?.code || 'ERROR',
        data?.error?.message || res.statusText || '请求失败',
      );
    }
    return data as T;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      if (init.signal?.aborted) throw e;
      throw new ApiError(408, 'TIMEOUT', '请求超时，请稍后重试');
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (init.signal) init.signal.removeEventListener('abort', onOuterAbort);
  }
}

export interface PageResult<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
}
