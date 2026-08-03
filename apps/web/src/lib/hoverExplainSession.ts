/**
 * 悬停讲解会话核心：incomplete TTL、L1 门控、清洗截断、流式累加。
 * AgentFloat / ArticleCardInlineAgent 共用；UI 层只消费回调，不重复状态机。
 */

import { streamAgent } from './agentStream';
import {
  hoverCacheKey,
  isSafeHoverDisplay,
  readHoverCache,
  sanitizeHoverDisplay,
  writeHoverCache,
} from './hoverExplainCache';
import { createHoverStreamAccumulator } from './hoverStreamBuffer';

export const INCOMPLETE_KEY_TTL_MS = 5 * 60 * 1000;
export const INCOMPLETE_KEY_MAX = 200;

/** B-11：incomplete 标记有 TTL/上限，避免长期累积且永不命中缓存 */
export class IncompleteHoverKeys {
  private readonly map = new Map<string, number>();

  mark(key: string) {
    this.map.set(key, Date.now());
    if (this.map.size > INCOMPLETE_KEY_MAX) {
      let oldestKey = '';
      let oldestAt = Infinity;
      for (const [k, t] of this.map) {
        if (t < oldestAt) {
          oldestAt = t;
          oldestKey = k;
        }
      }
      if (oldestKey) this.map.delete(oldestKey);
    }
  }

  /** 仍在 TTL 内则视为 incomplete（禁止读 L1） */
  isBlocked(key: string): boolean {
    const at = this.map.get(key);
    if (at == null) return false;
    if (Date.now() - at < INCOMPLETE_KEY_TTL_MS) return true;
    this.map.delete(key);
    return false;
  }

  clear(key?: string) {
    if (key) this.map.delete(key);
    else this.map.clear();
  }
}

/** 悬停答案不以？为合法句末（改稿自问） */
export function smartTruncateClient(s: string, max = 560): string {
  if (s.length <= max) return s.trim();
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'));
  if (end >= Math.floor(max * 0.45)) return cut.slice(0, end + 1).trim();
  return cut.replace(/[A-Za-z]{1,12}$/, '').trim();
}

export function sanitizeHoverAnswer(raw: string, truncateMax: number | false = 560): string {
  const cleaned = sanitizeHoverDisplay(raw);
  if (!cleaned) return '';
  if (truncateMax === false) return cleaned;
  return smartTruncateClient(cleaned, truncateMax);
}

export function peekHoverSessionCache(
  incomplete: IncompleteHoverKeys,
  topic: string,
  style: string,
): { key: string; cached: string | null } {
  const key = hoverCacheKey(topic, style);
  if (incomplete.isBlocked(key)) return { key, cached: null };
  const cached = readHoverCache(key);
  return { key, cached: cached && isSafeHoverDisplay(cached) ? cached : null };
}

export function pushHoverSessionCache(
  incomplete: IncompleteHoverKeys,
  key: string,
  text: string,
) {
  if (!isSafeHoverDisplay(text)) return;
  incomplete.clear(key);
  writeHoverCache(key, text);
}

export type HoverExplainSelection = {
  text: string;
  context?: string;
  sectionId?: string;
  title?: string;
  articleSlug?: string;
  route?: string;
};

export type HoverExplainFinal = {
  text: string;
  /** sanitize 后、failMessage 兜底前是否有洁净答案（影响揭示动画） */
  hasAnswer: boolean;
  complete: boolean;
  didStream: boolean;
  fromCache: boolean;
};

export type RunHoverExplainStreamParams = {
  style: string;
  /** 与 hoverCacheKey 一致的 topic（通常为 selection 截断） */
  cacheTopic: string;
  selection: HoverExplainSelection;
  signal: AbortSignal;
  incomplete: IncompleteHoverKeys;
  timeoutMs?: number;
  /** 流式展示截断；默认不截断。AgentFloat 传 600 */
  partialTruncateMax?: number;
  /** final 清洗后截断；false = 不截断。默认 560 */
  finalTruncateMax?: number | false;
  /** 请求开始时 mark incomplete；默认 true */
  markIncompleteOnStart?: boolean;
  /** 已 peek 过缓存时跳过再读；默认 false */
  skipCacheRead?: boolean;
  failMessage?: string;
  isStale?: () => boolean;
  onPartial?: (show: string) => void;
  onThinking?: () => void;
  /**
   * 缓存命中、或流内 final/done 结算时调用（Abort / 纯 stream error 不调用）。
   * 在 final 事件到达时即触发，不等待 Promise settle——与揭示时序一致。
   */
  onFinal?: (result: HoverExplainFinal) => void;
  onStreamError?: (message: string) => void;
};

export type HoverExplainStreamResult = HoverExplainFinal & {
  aborted: boolean;
  /** fetch/抛错（非 SSE error 事件、非 Abort） */
  transportFailed?: boolean;
};

/**
 * 统一悬停流：L1 → soft-stream 累加 → sanitize → 完整则写缓存。
 * 调用方负责 AbortController / 世代校验 / UI 揭示时序。
 */
export async function runHoverExplainStream(
  params: RunHoverExplainStreamParams,
): Promise<HoverExplainStreamResult> {
  const failMessage = params.failMessage ?? '讲解生成失败，请再试一次';
  const finalTruncate = params.finalTruncateMax === undefined ? 560 : params.finalTruncateMax;

  const key = hoverCacheKey(params.cacheTopic, params.style);

  if (!params.skipCacheRead) {
    const { cached } = peekHoverSessionCache(params.incomplete, params.cacheTopic, params.style);
    if (cached) {
      const result: HoverExplainFinal = {
        text: cached,
        hasAnswer: true,
        complete: true,
        didStream: false,
        fromCache: true,
      };
      params.onFinal?.(result);
      return { ...result, aborted: false };
    }
  }

  if (params.markIncompleteOnStart !== false) {
    params.incomplete.mark(key);
  }

  let gotFinal = false;
  let didStream = false;
  let settled = false;
  let lastResult: HoverExplainFinal = {
    text: '',
    hasAnswer: false,
    complete: false,
    didStream: false,
    fromCache: false,
  };
  let hadStreamError = false;
  const hoverAccum = createHoverStreamAccumulator();

  const settle = (cleaned: string) => {
    if (settled || params.isStale?.()) return;
    settled = true;
    const hasAnswer = Boolean(cleaned);
    const text = cleaned || failMessage;
    const complete = isSafeHoverDisplay(text);
    if (complete) pushHoverSessionCache(params.incomplete, key, text);
    else params.incomplete.mark(key);
    lastResult = { text, hasAnswer, complete, didStream, fromCache: false };
    params.onFinal?.(lastResult);
  };

  try {
    await streamAgent(
      '/agent/explain/stream',
      {
        mode: 'hover',
        style: params.style,
        selection: params.selection,
      },
      (ev) => {
        if (params.isStale?.()) return;

        if (ev.type === 'status' || ev.type === 'thinking') {
          params.onThinking?.();
          return;
        }

        if (ev.type === 'delta' && ev.text) {
          const { show } = hoverAccum.onDelta(ev.text, ev.replace);
          if (!show) {
            params.onThinking?.();
            return;
          }
          didStream = true;
          const out =
            params.partialTruncateMax != null
              ? smartTruncateClient(show, params.partialTruncateMax)
              : show;
          params.onPartial?.(out);
          return;
        }

        if (ev.type === 'final' && ev.answer != null) {
          gotFinal = true;
          // 只信 final.answer；禁止用缓冲原文回退成思考
          settle(sanitizeHoverAnswer(ev.answer, finalTruncate));
          return;
        }

        if (ev.type === 'done') {
          if (!gotFinal) {
            settle(sanitizeHoverAnswer(hoverAccum.get(), finalTruncate));
          }
          return;
        }

        if (ev.type === 'error') {
          hadStreamError = true;
          params.incomplete.mark(key);
          params.onStreamError?.(ev.message);
        }
      },
      params.signal,
      { timeoutMs: params.timeoutMs ?? 28_000 },
    );
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      params.incomplete.mark(key);
      return {
        text: '',
        hasAnswer: false,
        complete: false,
        didStream,
        fromCache: false,
        aborted: true,
      };
    }
    params.incomplete.mark(key);
    const msg = err instanceof Error ? err.message : failMessage;
    params.onStreamError?.(msg);
    return {
      text: '',
      hasAnswer: false,
      complete: false,
      didStream,
      fromCache: false,
      aborted: false,
      transportFailed: true,
    };
  }

  // 无 final/done 结算且非 stream error：兜底失败文案
  if (!settled && !hadStreamError && !params.isStale?.()) {
    settle('');
  }

  return { ...lastResult, didStream, aborted: false };
}
