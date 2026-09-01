import type { ArticleSummary, DomainSummary } from '@core/contracts';
import { request } from './client.js';

export const domainsApi = {
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
};
