import type { AnimationDef, ArticleDetail, ArticleSummary } from '@core/contracts';
import { type PageResult, request } from './client.js';

export const articlesApi = {
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
};
