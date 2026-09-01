import { request } from './client.js';

export const settingsApi = {
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
};
