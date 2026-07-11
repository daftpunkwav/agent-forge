import type {
  AnimationDef,
  ArticleDetail,
  ArticleSummary,
  AuthTokens,
  DomainSummary,
  PublicUser,
} from '@agentforge/shared';

import { getToken, setToken } from './apiToken';

const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export { setToken, getToken };

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(
      res.status,
      data?.error?.code || 'ERROR',
      data?.error?.message || res.statusText || '请求失败',
    );
  }
  return data as T;
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

  me: () => request<{ user: PublicUser }>('/auth/me'),

  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),

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
    request<{ user: PublicUser; accessToken?: string }>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  listTopics: (params?: { page?: number; pageSize?: number; articleId?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.articleId) q.set('articleId', params.articleId);
    const qs = q.toString();
    return request<PageResult<import('@agentforge/shared').TopicSummary>>(
      `/topics${qs ? `?${qs}` : ''}`,
    );
  },

  getTopic: (id: string) =>
    request<{
      topic: import('@agentforge/shared').TopicSummary;
      replies: { id: string; body: string; createdAt: string; author: { id: string; name: string } }[];
    }>(`/topics/${id}`),

  createTopic: (body: {
    title: string;
    body: string;
    kind?: string;
    articleId?: string;
    articleSlug?: string;
  }) =>
    request<{ topic: import('@agentforge/shared').TopicSummary }>('/topics', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  replyTopic: (id: string, body: string) =>
    request<{ reply: unknown }>(`/topics/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),

  listAnnotations: (slugOrId: string) =>
    request<{ items: import('@agentforge/shared').AnnotationItem[]; articleId: string }>(
      `/annotations/article/${slugOrId}`,
    ),

  createAnnotation: (body: {
    articleId?: string;
    articleSlug?: string;
    anchorText?: string;
    sectionId?: string;
    body: string;
  }) =>
    request<{ annotation: import('@agentforge/shared').AnnotationItem }>('/annotations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reviewAnnotation: (id: string, status: 'approved' | 'rejected', note?: string) =>
    request<{ annotation: import('@agentforge/shared').AnnotationItem }>(
      `/annotations/${id}/review`,
      { method: 'PATCH', body: JSON.stringify({ status, note }) },
    ),

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
    context?: { route?: string; articleSlug?: string; sectionId?: string };
    style?: string;
    mode?: 'fast' | 'deep';
  }) =>
    request<{
      reply: string;
      thinking?: string;
      conversationId?: string;
      model: string;
      format: string;
      style: string;
    }>('/agent/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  agentProgress: (body: {
    articleSlug: string;
    progress?: number;
    mastery?: 'not_started' | 'learning' | 'mastered';
  }) => request<{ item: unknown }>('/agent/progress', { method: 'POST', body: JSON.stringify(body) }),
};
