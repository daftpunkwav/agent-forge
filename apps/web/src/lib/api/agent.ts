import { request } from './client.js';

export const agentApi = {
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
};
