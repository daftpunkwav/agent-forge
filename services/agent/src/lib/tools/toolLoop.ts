/**
 * Prompt-based ReAct tool-loop（P0）：非原生 tools API。
 * Thought → TOOL_CALL → Observation → … → Final Answer
 * 工厂注入 LlmGatewayPort 与工具注册表——不依赖任何具体服务实现。
 */
import type { ApiFormat, ChatMessage, ProviderConfig } from '@core/contracts';
import { logger } from '@core/foundation';
import { extractVisibleAnswer } from '@core/foundation';
import { TOOL_LOOP_MAX_ITERS, TOOL_LOOP_OVERALL_MS, TOOL_TIMEOUT_MS } from '../agentConstants.js';
import { parseToolCall } from './parseToolCall.js';
import type { LlmGatewayPort } from '../../ports.js';
import type { ToolLoopEvent } from './types.js';

export type RunToolLoopOpts = {
  provider: ProviderConfig;
  system: string;
  userContent: string;
  maxTokens: number;
  temperature?: number;
  /** 外层取消（客户端断开） */
  signal?: AbortSignal;
  maxIters?: number;
  toolTimeoutMs?: number;
  /** R-08：循环级总时限覆盖（默认 TOOL_LOOP_OVERALL_MS） */
  overallTimeoutMs?: number;
  onEvent?: (ev: ToolLoopEvent) => void;
};

export type ToolLoopResult = {
  answer: string;
  thinking: string;
  model: string;
  format: ApiFormat;
  iterations: number;
  hitMaxIters: boolean;
};

/** 工厂：注入 LLM 网关与工具执行器 */
export function createToolLoop(
  llm: LlmGatewayPort,
  executeTool: (name: string, rawArgs: unknown, ctx: { signal?: AbortSignal }) => Promise<{
    ok: boolean;
    observation: string;
    ms: number;
  }>,
) {
  function previewObservation(s: string, max = 160): string {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  /** 合并外层 abort 与单次工具超时（外层信号即循环级总时限信号） */
  function toolSignal(outer: AbortSignal | undefined, timeoutMs: number): AbortSignal {
    const timed = AbortSignal.timeout(timeoutMs);
    if (!outer) return timed;
    if (typeof AbortSignal.any === 'function') {
      return AbortSignal.any([outer, timed]);
    }
    // Node <20.3 兜底：仅用超时；外层 abort 由循环顶部检查
    return timed;
  }

  /**
   * 同步多轮工具循环。中间轮用 callLlm（需完整文本解析 TOOL_CALL）；
   * 通过 onEvent 向 SSE 推送 tool_call / tool_result。
   */
  async function runToolLoop(opts: RunToolLoopOpts): Promise<ToolLoopResult> {
    const maxIters = opts.maxIters ?? TOOL_LOOP_MAX_ITERS;
    const toolTimeoutMs = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
    const messages: ChatMessage[] = [
      { role: 'system', content: opts.system },
      { role: 'user', content: opts.userContent },
    ];

    // R-08：循环级总时限——防止 5 轮 × (30s LLM + 8s 工具) ≈ 190s 空跑
    const overallMs = opts.overallTimeoutMs ?? TOOL_LOOP_OVERALL_MS;
    const deadlineSignal = AbortSignal.timeout(overallMs);
    const loopSignal =
      opts.signal && typeof AbortSignal.any === 'function'
        ? AbortSignal.any([opts.signal, deadlineSignal])
        : opts.signal || deadlineSignal;

    let model = opts.provider.model;
    let format = opts.provider.format;
    let lastThinking = '';
    for (let i = 0; i < maxIters; i++) {
      if (loopSignal.aborted) {
        // R-08：总时限触顶 → 优雅收尾；客户端断开（外层取消）→ 正常中断
        if (deadlineSignal.aborted && !opts.signal?.aborted) {
          logger.warn({ event: 'tool_loop_deadline', iterations: i + 1 }, 'tool loop deadline');
          const answer = '这个问题涉及的检索步骤较多，已超过本轮时限。请缩小问题范围，或关闭「允许工具」直接提问。';
          opts.onEvent?.({ type: 'delta', text: answer });
          return { answer, thinking: lastThinking, model, format, iterations: i + 1, hitMaxIters: true };
        }
        const err = new Error('Aborted');
        err.name = 'AbortError';
        throw err;
      }

      let result: Awaited<ReturnType<LlmGatewayPort['callLlm']>>;
      try {
        result = await llm.callLlm(
          {
            mode: 'deep',
            maxTokens: opts.maxTokens,
            temperature: opts.temperature,
            messages,
            signal: loopSignal,
          },
          opts.provider,
        );
      } catch (e) {
        // R-08：总时限触顶——优雅收尾，告知用户可缩小范围重试；不当作系统故障
        if (deadlineSignal.aborted && !opts.signal?.aborted) {
          logger.warn({ event: 'tool_loop_deadline', iterations: i + 1 }, 'tool loop deadline');
          const answer = '这个问题涉及的检索步骤较多，已超过本轮时限。请缩小问题范围，或关闭「允许工具」直接提问。';
          opts.onEvent?.({ type: 'delta', text: answer });
          return { answer, thinking: lastThinking, model, format, iterations: i + 1, hitMaxIters: true };
        }
        throw e;
      }
      model = result.model;
      format = result.format;

      const combined = [result.text || '', result.thinking || ''].filter(Boolean).join('\n');
      const toolCall = parseToolCall(combined) || parseToolCall(result.text || '');

      if (!toolCall) {
        const visible = extractVisibleAnswer(result.thinking || '', result.text || '');
        const answer =
          visible.answer ||
          (result.text || '').trim() ||
          '抱歉，这一轮没有生成有效回答，换个问法再试一次。';
        if (visible.thinking) {
          lastThinking = visible.thinking;
          opts.onEvent?.({ type: 'thinking', text: visible.thinking });
        }
        opts.onEvent?.({ type: 'delta', text: answer });
        logger.info(
          { event: 'tool_loop_done', iterations: i + 1, hitMaxIters: false },
          'tool loop finished',
        );
        return {
          answer,
          thinking: lastThinking || visible.thinking,
          model,
          format,
          iterations: i + 1,
          hitMaxIters: false,
        };
      }

      opts.onEvent?.({ type: 'tool_call', name: toolCall.name, args: toolCall.args });

      let exec;
      try {
        exec = await executeTool(toolCall.name, toolCall.args, {
          signal: toolSignal(loopSignal, toolTimeoutMs),
        });
      } catch (e) {
        // R-08：总时限在工具执行窗口内触顶——同样优雅收尾，不静默截断流
        if (deadlineSignal.aborted && !opts.signal?.aborted) {
          logger.warn({ event: 'tool_loop_deadline', iterations: i + 1 }, 'tool loop deadline');
          const answer = '这个问题涉及的检索步骤较多，已超过本轮时限。请缩小问题范围，或关闭「允许工具」直接提问。';
          opts.onEvent?.({ type: 'delta', text: answer });
          return { answer, thinking: lastThinking, model, format, iterations: i + 1, hitMaxIters: true };
        }
        throw e;
      }

      opts.onEvent?.({
        type: 'tool_result',
        name: toolCall.name,
        ok: exec.ok,
        preview: previewObservation(exec.observation),
      });

      // 把本轮 TOOL_CALL 与 Observation 追加进对话
      const assistantLine = `TOOL_CALL: ${JSON.stringify({ name: toolCall.name, args: toolCall.args })}`;
      messages.push({ role: 'assistant', content: assistantLine });
      messages.push({
        role: 'user',
        content: `Observation (${toolCall.name}):\n${exec.observation}`,
      });
    }

    logger.warn(
      { event: 'tool_loop_max_iters', maxIters },
      'tool loop hit max iterations',
    );
    const answer =
      '已达到工具调用次数上限，请缩小问题范围或关闭「允许工具」后重试。';
    opts.onEvent?.({ type: 'delta', text: answer });
    return {
      answer,
      thinking: lastThinking,
      model,
      format,
      iterations: maxIters,
      hitMaxIters: true,
    };
  }

  return { runToolLoop };
}

export type ToolLoop = ReturnType<typeof createToolLoop>;
