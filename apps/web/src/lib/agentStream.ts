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
      conversationId?: string;
      guestKey?: string;
      cached?: boolean;
      reasoningMode?: string;
      meta?: unknown;
    }
  | { type: 'status'; status: 'thinking' | 'answering' }
  | { type: 'thinking'; text: string }
  /** replace=true：用 text 覆盖已累计正文（策划切到讲解时的重同步） */
  | { type: 'delta'; text: string; replace?: boolean }
  | { type: 'tool_call'; name: string; args?: unknown }
  | { type: 'tool_result'; name: string; ok: boolean; preview?: string }
  | { type: 'final'; answer?: string; thinking?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/** 读取 SSE 流（agent explain/chat stream）；默认 28s 超时防悬挂 */
export async function streamAgent(
  path: '/agent/explain/stream' | '/agent/chat/stream',
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
  signal?: AbortSignal,
  opts?: { timeoutMs?: number },
): Promise<void> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutMs = opts?.timeoutMs ?? 28_000;
  const timeoutAc = new AbortController();
  // C-09：独立超时标志，避免与「主动取消」共用 AbortError 判断导致歧义
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    timeoutAc.abort();
  }, timeoutMs);
  const onOuterAbort = () => timeoutAc.abort();
  if (signal) {
    if (signal.aborted) timeoutAc.abort();
    else signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: timeoutAc.signal,
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
  } catch (e) {
    if (timedOut) throw new Error('讲解超时，请再悬停试一次');
    if (e instanceof Error && e.name === 'AbortError') {
      if (signal?.aborted) throw e; // 主动取消
      throw new Error('讲解超时，请再悬停试一次'); // 超时
    }
    throw e;
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onOuterAbort);
  }
}
