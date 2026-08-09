import type { LlmRequest } from './types.js';
import { LLM_CALL_TIMEOUT_MS, LLM_TOKEN_LIMITS } from './config.js';

/** 上游 LLM 调用错误（A-01）：messageForClient 面向客户端，诊断字段只进日志 */
export class LlmCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly messageForClient: string,
    public readonly diagnostic: { url: string; raw: string },
    /** 业务标记，用于区分同类状态码的不同语义（如 503：上游熔断 vs 本地容量满） */
    public readonly code?: string,
  ) {
    super(messageForClient);
    this.name = 'LlmCallError';
  }
}

/** 仅 5xx / 网络层失败可重试；4xx（参数/鉴权）与超时、客户端取消不重试（B-05） */
export function isRetriable(e: unknown): boolean {
  if (e instanceof LlmCallError) return e.status === 502 || e.status === 503 || e.status === 504;
  // fetch 网络层失败（非 HTTP 状态）表现为 TypeError
  return e instanceof TypeError;
}

export function isAbortError(e: unknown): boolean {
  // AbortSignal.timeout 触发时 Node fetch 拒绝的是 name === 'TimeoutError' 的 DOMException，
  // 手动 AbortController 取消则是 'AbortError'——两者都按中断处理
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 同步调用统一加超时（A-02）：调用方 signal 与超时信号任一触发即中断。
 * 返回 timedOut() 用于区分「超时」与「主动取消」。
 */
export function withTimeout(req: LlmRequest): { req: LlmRequest; timedOut: () => boolean } {
  const timeoutSignal = AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);
  const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;
  return { req: { ...req, signal }, timedOut: () => timeoutSignal.aborted };
}

/** 防御性兜底：调用方未传参时取单一来源默认（C-03） */
export function tokenDefaults(req: LlmRequest): { maxTokens: number; temperature: number } {
  const d = LLM_TOKEN_LIMITS[req.mode === 'fast' ? 'hover' : 'clickDeep'];
  return { maxTokens: req.maxTokens ?? d.maxTokens, temperature: req.temperature ?? d.temperature };
}

export function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
