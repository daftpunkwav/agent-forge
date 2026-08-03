/**
 * Prompt-based ReAct tool-loop（P0）：非原生 tools API。
 * Thought → TOOL_CALL → Observation → … → Final Answer
 */
import type { ApiFormat, ChatMessage, ProviderConfig } from '../types.js';
import { callLlm } from '../providers.js';
import { extractVisibleAnswer } from '../agentPrompt.js';
import { TOOL_LOOP_MAX_ITERS, TOOL_TIMEOUT_MS } from '../config.js';
import { logger } from '../../logger.js';
import { parseToolCall } from './parseToolCall.js';
import { executeTool } from './registry.js';
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

function previewObservation(s: string, max = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 合并外层 abort 与单次工具超时 */
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
export async function runToolLoop(opts: RunToolLoopOpts): Promise<ToolLoopResult> {
  const maxIters = opts.maxIters ?? TOOL_LOOP_MAX_ITERS;
  const toolTimeoutMs = opts.toolTimeoutMs ?? TOOL_TIMEOUT_MS;
  const messages: ChatMessage[] = [
    { role: 'system', content: opts.system },
    { role: 'user', content: opts.userContent },
  ];

  let model = opts.provider.model;
  let format = opts.provider.format;
  let lastThinking = '';
  let hitMaxIters = false;

  for (let i = 0; i < maxIters; i++) {
    if (opts.signal?.aborted) {
      const err = new Error('Aborted');
      err.name = 'AbortError';
      throw err;
    }

    const result = await callLlm(
      {
        mode: 'deep',
        maxTokens: opts.maxTokens,
        temperature: opts.temperature,
        messages,
        signal: opts.signal,
      },
      opts.provider,
    );
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

    const exec = await executeTool(toolCall.name, toolCall.args, {
      signal: toolSignal(opts.signal, toolTimeoutMs),
    });

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

    if (i === maxIters - 1) {
      hitMaxIters = true;
    }
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
