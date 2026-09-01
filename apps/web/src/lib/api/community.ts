import type { TopicSummary } from '@core/contracts';
import { type PageResult, request } from './client.js';

export const communityApi = {
  listTopics: (params?: { page?: number; pageSize?: number; articleId?: string }) => {
    const q = new URLSearchParams();
    if (params?.page) q.set('page', String(params.page));
    if (params?.pageSize) q.set('pageSize', String(params.pageSize));
    if (params?.articleId) q.set('articleId', params.articleId);
    const qs = q.toString();
    return request<PageResult<TopicSummary>>(`/topics${qs ? `?${qs}` : ''}`);
  },

  getTopic: (id: string) =>
    request<{
      topic: TopicSummary;
      replies: { id: string; body: string; createdAt: string; author: { id: string; name: string } }[];
    }>(`/topics/${id}`),

  createTopic: (body: {
    title: string;
    body: string;
    kind?: string;
    articleId?: string;
    articleSlug?: string;
  }) =>
    request<{ topic: TopicSummary }>('/topics', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  replyTopic: (id: string, body: string) =>
    request<{ reply: unknown }>(`/topics/${id}/replies`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
};
