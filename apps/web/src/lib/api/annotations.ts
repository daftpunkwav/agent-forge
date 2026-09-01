import type { AnnotationItem } from '@core/contracts';
import { request } from './client.js';

export const annotationsApi = {
  listAnnotations: (params: { articleId?: string; articleSlug?: string }) => {
    const q = new URLSearchParams();
    if (params.articleId) q.set('articleId', params.articleId);
    if (params.articleSlug) q.set('articleSlug', params.articleSlug);
    const qs = q.toString();
    return request<{ items: AnnotationItem[] }>(`/annotations${qs ? `?${qs}` : ''}`);
  },

  createAnnotation: (body: {
    articleId?: string;
    articleSlug?: string;
    anchorText: string;
    sectionId?: string;
    body: string;
  }) =>
    request<{ annotation: AnnotationItem }>('/annotations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  reviewAnnotation: (id: string, body: { status: 'approved' | 'rejected'; agentNote?: string }) =>
    request<{ annotation: AnnotationItem }>(`/annotations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
};
