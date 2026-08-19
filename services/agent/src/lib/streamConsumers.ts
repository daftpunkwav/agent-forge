/**
 * 流式消费器(深模块)——承载 explain/chat 两个 SSE handler 共用的流消费逻辑:
 *   - 累计 thinking/text
 *   - deep 模式的 per-delta 思考门控(isSystemEcho 拦截 → safeThinking)
 *   - hover 模式的早停探测(2 句安全答案 → abort 上游)
 *   - status 节流(explain hover 100ms;chat fast 不节流)
 * 路由层保留:循环骨架、SSE 写回、最终事件组装。
 * 独立于 Express,可脱离路由单测。
 */
import type { StreamChunk } from '@core/contracts';
import { extractHoverAnswer, isSafeHoverPublicAnswer, isSystemEcho } from '@core/contracts';
import { logger } from '@core/foundation';

export type StreamMode = 'hover' | 'fast' | 'deep';

export interface StreamConsumerOptions {
  /** hover:早停探测 + 思考绝不回传;fast:仅 status(无早停);deep:门控后回传思考 */
  mode: StreamMode;
  /** hover 早停打点用 */
  topic?: string;
  /** status 节流间隔(ms);0 = 不节流(chat fast 语义) */
  statusThrottleMs?: number;
  /** 早停探测节流(ms) */
  probeThrottleMs?: number;
  /** 早停探测最小增量(字符) */
  probeMinDelta?: number;
  /** 触发上游中止(hover 早停时) */
  abort: () => void;
  /** 节流后的 status(hover/fast 专用) */
  onStatus?: () => void;
  /** 已门控的安全思考片段(deep 专用) */
  onThinking?: (text: string) => void;
  /** 文本 delta(deep 专用) */
  onText?: (text: string) => void;
}

export interface StreamConsumeResult {
  thinkingAcc: string;
  textAcc: string;
  safeThinking: string;
  /** hover 早停答案(空 = 未早停) */
  earlyAnswer: string;
}

export function createStreamConsumer(opts: StreamConsumerOptions) {
  let thinkingAcc = '';
  let textAcc = '';
  let safeThinking = '';
  let earlyAnswer = '';
  let lastStatusAt = 0;
  let lastProbeAt = 0;
  let lastProbeLen = 0;

  const isHover = opts.mode === 'hover';
  // hover/fast:思考不回传,只发 status
  const isQuiet = isHover || opts.mode === 'fast';

  function emitStatus(): void {
    const now = Date.now();
    const throttle = opts.statusThrottleMs ?? 0;
    if (throttle > 0 && now - lastStatusAt < throttle) return;
    lastStatusAt = now;
    opts.onStatus?.();
  }

  function probeEarlyAnswer(): void {
    if (earlyAnswer) return;
    const total = thinkingAcc.length + textAcc.length;
    const now = Date.now();
    if (
      now - lastProbeAt < (opts.probeThrottleMs ?? 220) &&
      total - lastProbeLen < (opts.probeMinDelta ?? 60)
    ) {
      return;
    }
    lastProbeAt = now;
    lastProbeLen = total;
    const candidate = extractHoverAnswer(thinkingAcc, textAcc);
    // 早停要求至少 2 句，避免半截单句抢跑
    const n = (candidate.match(/[。！]/g) || []).length;
    if (candidate && n >= 2 && isSafeHoverPublicAnswer(candidate)) {
      earlyAnswer = candidate;
      // B-06：早停命中打点（省 token 的可观测性）
      logger.info(
        { event: 'hover_early_stop', topic: (opts.topic || '').slice(0, 60), chars: total },
        'hover early stop',
      );
      opts.abort();
    }
  }

  /**
   * 消费一个 chunk。返回 'break' 表示应停止消费(早停已命中)。
   * 调用方在循环顶部自行处理客户端断开(sse.gone / signal.aborted)。
   */
  function handle(chunk: StreamChunk): 'break' | 'continue' | void {
    if (earlyAnswer) return 'break';
    if (chunk.kind === 'thinking') {
      thinkingAcc += chunk.text;
      if (isQuiet) {
        emitStatus();
        if (isHover) probeEarlyAnswer();
      } else {
        // A-04：思考片段命中 system 规则复述不回传客户端（final 门控是兜底，流式先拦）
        if (isSystemEcho(chunk.text)) {
          logger.warn({ event: 'thinking_echo_blocked' }, 'thinking echo chunk dropped');
          return 'continue';
        }
        safeThinking += chunk.text;
        opts.onThinking?.(chunk.text);
      }
    } else {
      textAcc += chunk.text;
      if (isQuiet) {
        emitStatus();
        if (isHover) probeEarlyAnswer();
      } else {
        opts.onText?.(chunk.text);
      }
    }
  }

  return {
    handle,
    result(): StreamConsumeResult {
      return { thinkingAcc, textAcc, safeThinking, earlyAnswer };
    },
  };
}

export type StreamConsumer = ReturnType<typeof createStreamConsumer>;
