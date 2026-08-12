import type {
  AnimationDef,
  ArticleDetail,
  ArticleSummary,
  AuthTokens,
  DomainSummary,
  PublicUser,
} from '@core/contracts';

import {
  clearTokens,
  getRefreshToken,
  getToken,
  setRefreshToken,
  setToken,
  setTokens,
} from './apiToken';

const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

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
        const data = (await res.json().catch(() => ({}))) as Partial<AuthTokens>;
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

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  // 超时与调用方 signal 合并：任一触发即中断 fetch
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

    // access 过期：尝试 refresh 一次后重试（跳过 refresh/logout 自身）
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

export const api = {
  health: () => fetch(BASE.replace(/\/api\/v1$/, '') + '/health').then((r) => r.json()),

  register: (body: { email: string; password: string; name: string }) =>
    request<AuthTokens>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),

  login: (body: { email: string; password: string }) =>
    request<AuthTokens>('/auth/login', { method: 'POST', body: JSON.stringify(body) }),

  refresh: (refreshToken: string) =>
    request<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),

  me: () => request<{ user: PublicUser }>('/auth/me'),

  logout: (body?: { refreshToken?: string | null }) =>
    request<{ ok: boolean }>('/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: body?.refreshToken || undefined }),
    }),

  listArticles: (params?: {
    status?: string;
    mine?: boolean;
    category?: string;
    domain?: string;
    domainId?: string;
    level?: string;
    q?: string;
    page?: number;
    pageSize?: number;
    sort?: 'latest' | 'popular';
    exclude?: string[];
  }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set('status', params.status);
    if (params?.mine) q.set('mine', '1');
    if (params?.category) q.set('category', params.category);
    if (params?.domain) q.set('domain', params.domain);
    if (params?.domainId) q.set('domainId', params.domainId);
    if (params?.level) q.set('level', params.level);
    if (params?.q) q.set('q', params.q);
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.sort) q.set('sort', params.sort);
    if (params?.exclude?.length) q.set('exclude', params.exclude.join(','));
    const qs = q.toString();
    return request<PageResult<ArticleSummary>>(`/articles${qs ? `?${qs}` : ''}`);
  },

  getArticle: (slug: string) => request<{ article: ArticleDetail }>(`/articles/${slug}`),

  createArticle: (body: Record<string, unknown>) =>
    request<{ article: ArticleDetail }>('/articles', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateArticle: (id: string, body: Record<string, unknown>) =>
    request<{ article: ArticleDetail }>(`/articles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  publishArticle: (id: string) =>
    request<{ article: ArticleDetail }>(`/articles/${id}/publish`, { method: 'POST' }),

  listAnimations: (mine = true) =>
    request<{ items: AnimationDef[] }>(`/animations?mine=${mine ? '1' : '0'}`),

  getAnimation: (id: string) => request<{ animation: AnimationDef }>(`/animations/${id}`),

  createAnimation: (body: {
    name: string;
    template: string;
    steps: AnimationDef['steps'];
    config?: Record<string, unknown>;
  }) =>
    request<{ animation: AnimationDef }>('/animations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAnimation: (id: string, body: Record<string, unknown>) =>
    request<{ animation: AnimationDef }>(`/animations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  applyAuthor: (body: { field: string; bio: string; kind?: 'author' | 'elite' }) =>
    request<{ application: unknown }>('/author-applications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateProfile: (body: Record<string, unknown>) =>
    request<AuthTokens>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  listTopics: (params?: { page?: number; pageSize?: number; articleId?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.articleId) q.set('articleId', params.articleId);
    const qs = q.toString();
    return request<PageResult<import('@core/contracts').TopicSummary>>(
      `/topics${qs ? `?${qs}` : ''}`,
    );
  },

  getTopic: (id: string) =>
    request<{
      topic: import('@core/contracts').TopicSummary;
      replies: { id: string; body: string; createdAt: string; author: { id: string; name: string } }[];
    }>(`/topics/${id}`),

  createTopic: (body: {
    title: string;
    body: string;
    kind?: string;
    articleId?: string;
    articleSlug?: string;
  }) =>
    request<{ topic: import('@core/contracts').TopicSummary }>('/topics', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  replyTopic: (id: string, body: string) =>
    request<{ reply: unknown }>(`/topics/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),


  listApplications: () => request<{ items: unknown[] }>('/author-applications'),

  reviewApplication: (id: string, status: 'approved' | 'rejected') =>
    request<{ application: unknown }>(`/author-applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  // Domains
  listDomains: (track?: 'agent' | 'llm', all = false) => {
    const q = new URLSearchParams();
    if (track) q.set('track', track);
    if (all) q.set('all', '1');
    const qs = q.toString();
    return request<{ items: DomainSummary[] }>(`/domains${qs ? `?${qs}` : ''}`);
  },

  getDomain: (
    slug: string,
    params?: { page?: number; pageSize?: number; q?: string; level?: string; sort?: string },
  ) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize ?? 8));
    if (params?.q) q.set('q', params.q);
    if (params?.level) q.set('level', params.level);
    if (params?.sort) q.set('sort', params.sort);
    const qs = q.toString();
    return request<{
      domain: DomainSummary;
      items: ArticleSummary[];
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
    }>(`/domains/${slug}${qs ? `?${qs}` : ''}`);
  },

  createDomain: (body: Record<string, unknown>) =>
    request<{ domain: DomainSummary }>('/domains', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateDomain: (id: string, body: Record<string, unknown>) =>
    request<{ domain: DomainSummary }>(`/domains/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deleteDomain: (id: string) => request<{ ok: boolean }>(`/domains/${id}`, { method: 'DELETE' }),

  // Settings
  getSettings: () =>
    request<{
      preferences: Record<string, unknown>;
      agentStyles: { id: string; label: string }[];
      apiFormats?: { id: string; label: string; desc: string }[];
      serverProviders?: { id: string; name: string; model: string; format: string; vision: boolean }[];
      providers?: { id: string; name: string; model: string; format: string; vision: boolean }[];
    }>('/settings/me'),

  updateSettings: (body: Record<string, unknown>) =>
    request<{ preferences: Record<string, unknown> }>('/settings/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  testLlm: () =>
    request<{
      ok: boolean;
      model: string;
      format: string;
      providerId: string;
      sample: string;
    }>('/settings/test-llm', { method: 'POST', body: '{}' }),

  // Agent
  /** 清除服务端悬停讲解缓存（L2）；前端 L1 需另行 clearAllHoverCaches */
  clearAgentCache: () =>
    request<{ ok: boolean; cleared: number; scope: string; message: string }>(
      '/agent/cache/clear',
      { method: 'POST', body: '{}' },
    ),

  agentProviders: () =>
    request<{
      providers: unknown[];
      defaultId: string | null;
      formats: string[];
    }>('/agent/providers'),

  agentExplain: (body: {
    mode: 'hover' | 'click';
    selection: {
      text: string;
      sectionId?: string;
      route?: string;
      articleSlug?: string;
      title?: string;
    };
    style?: string;
  }) =>
    request<{
      explanation: string;
      mode: string;
      model: string;
      format: string;
      style: string;
    }>('/agent/explain', { method: 'POST', body: JSON.stringify(body) }),

  agentChat: (body: {
    message: string;
    conversationId?: string;
    guestKey?: string;
    context?: { route?: string; articleSlug?: string; sectionId?: string };
    style?: string;
    mode?: 'fast' | 'deep';
    reasoningMode?: 'deep_teach' | 'react';
    toolsEnabled?: boolean;
  }) =>
    request<{
      reply: string;
      thinking?: string;
      conversationId?: string;
      guestKey?: string;
      model: string;
      format: string;
      style: string;
      reasoningMode?: string;
    }>('/agent/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  agentProgress: (body: {
    articleSlug: string;
    progress?: number;
    mastery?: 'not_started' | 'learning' | 'mastered';
  }) => request<{ item: unknown }>('/agent/progress', { method: 'POST', body: JSON.stringify(body) }),

  // Annotations（与并发前端批注 UI 对齐）
  listAnnotations: (params: { articleId?: string; articleSlug?: string }) => {
    const q = new URLSearchParams();
    if (params.articleId) q.set('articleId', params.articleId);
    if (params.articleSlug) q.set('articleSlug', params.articleSlug);
    const qs = q.toString();
    return request<{ items: import('@core/contracts').AnnotationItem[] }>(
      `/annotations${qs ? `?${qs}` : ''}`,
    );
  },

  createAnnotation: (body: {
    articleId?: string;
    articleSlug?: string;
    anchorText: string;
    sectionId?: string;
    body: string;
  }) =>
    request<{ annotation: import('@core/contracts').AnnotationItem }>('/annotations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reviewAnnotation: (id: string, body: { status: 'approved' | 'rejected'; agentNote?: string }) =>
    request<{ annotation: import('@core/contracts').AnnotationItem }>(`/annotations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
