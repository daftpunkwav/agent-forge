import type { Response } from 'express';
import type { SseSession } from '@core/foundation';
import { sseWrite } from '@core/foundation';
import type { LlmGatewayPort } from '@core/contracts';
import { AGENT_MODE_META } from '../lib/agentPrompt.js';

/** 悬停缓存命中 JSON 响应体 */
export function hoverCacheJson(
  body: { mode: 'hover' | 'click' },
  style: string,
  cached: string,
) {
  return {
    explanation: cached,
    mode: body.mode,
    model: 'cache',
    format: 'cache',
    style,
    providerId: 'hover-cache',
    cached: true,
    meta: AGENT_MODE_META.fast,
  };
}

export function sseWriteHoverCache(
  res: Response,
  body: { mode: 'hover' | 'click' },
  style: string,
  cached: string,
) {
  sseWrite(res, {
    type: 'meta',
    model: 'cache',
    format: 'cache',
    providerId: 'hover-cache',
    mode: body.mode,
    style,
    cached: true,
    meta: AGENT_MODE_META.fast,
  });
  sseWrite(res, { type: 'final', answer: cached, thinking: '' });
  sseWrite(res, { type: 'done' });
}

/** SSE 流结束前的 LLM 错误写入（脱敏） */
export function writeAgentSseError(
  sse: SseSession,
  res: Response,
  llm: LlmGatewayPort,
  e: unknown,
  fallbackMessage: string,
): void {
  if (e instanceof Error && e.name === 'AbortError') return;
  if (sse.gone()) return;
  const message = llm.isLlmCallError(e) ? e.messageForClient : fallbackMessage;
  sseWrite(res, { type: 'error', message });
}
