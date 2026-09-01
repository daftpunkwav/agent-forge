import type { AuthTokens, PublicUser } from '@core/contracts';
import { BASE, request } from './client.js';

export const authApi = {
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

  updateProfile: (body: Record<string, unknown>) =>
    request<AuthTokens>('/auth/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  applyAuthor: (body: { field: string; bio: string; kind?: 'author' | 'elite' }) =>
    request<{ application: unknown }>('/author-applications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  listApplications: () => request<{ items: unknown[] }>('/author-applications'),

  reviewApplication: (id: string, status: 'approved' | 'rejected') =>
    request<{ application: unknown }>(`/author-applications/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};
