import { getToken } from './apiToken';

const BASE = import.meta.env.VITE_API_BASE_URL || '/api/v1';

export type StreamEvent =
  | {
      type: 'meta';
      model?: string;
      format?: string;
      providerId?: string;
      mode?: string;
      style?: string;
      meta?: unknown;
    }
  | { type: 'status'; status: 'thinking' | 'answering' }
  | { type: 'thinking'; text: string }
  | { type: 'delta'; text: string }
  | { type: 'final'; answer?: string; thinking?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** 读取 SSE 流（agent explain/chat stream） */
export async function streamAgent(
  path: '/agent/explain/stream' | '/agent/chat/stream',
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    let msg = res.statusText;
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      if (j?.error?.message) msg = j.error.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }

  if (!res.body) {
    throw new Error('浏览器不支持流式读取');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop() || '';
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload) continue;
      try {
        const ev = JSON.parse(payload) as StreamEvent;
        onEvent(ev);
      } catch {
        /* ignore */
      }
    }
  }
}
