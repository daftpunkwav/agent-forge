/**
 * Agent Orchestrator（自 routes/agent.ts 拆分）
 * 讲解/对话的上下文组装、答案门控、错误映射与收尾持久化；路由层只做 HTTP/SSE 适配。
 * 工厂注入 AgentDeps(外部 ports)+ 内部协作者(会话/记忆/缓存/工具循环)——服务内依赖显式化,便于独立测试。
 */
import { z } from 'zod';
import { logger, AppError } from '@core/foundation';
import {
  buildDeepSystem,
  buildHoverRetrySystem,
  buildHoverSystem,
  buildReactSystem,
} from '../lib/agentPrompt.js';
import { extractHoverAnswer, isSafeHoverPublicAnswer } from '@core/contracts';
import { HOVER_RETRY_TIMEOUT_MS } from '../lib/agentConstants.js';
import { LLM_TOKEN_LIMITS } from '@core/contracts';
import type { AgentDeps } from '../ports.js';
import type { ProviderConfig } from '@core/contracts';
import type { AgentConversation } from './agentConversation.js';
import type { HoverCache } from './hoverCache.js';
import type { AgentMemory } from './agentMemory.js';
import type { ToolLoop } from '../lib/tools/toolLoop.js';

export const explainSchemaFixed = z.object({
  mode: z.enum(['hover', 'click']),
  selection: z.object({
    text: z.string().min(1).max(4000),
    context: z.string().max(2000).optional(),
    sectionId: z.string().max(120).optional(),
    route: z.string().max(300).optional(),
    articleSlug: z.string().max(120).optional(),
    title: z.string().max(200).optional(),
  }),
  style: z.string().max(40).optional(),
});

export const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().max(64).optional(),
  /** 匿名会话 ACL：与 conversation.guestKey 匹配；登录用户忽略 */
  guestKey: z.string().min(16).max(80).optional(),
  context: z
    .object({
      route: z.string().max(300).optional(),
      articleSlug: z.string().max(120).optional(),
      sectionId: z.string().max(120).optional(),
    })
    .optional(),
  style: z.string().max(40).optional(),
  mode: z.enum(['fast', 'deep']).optional(),
  /** 推理模式：react 启用真 tool-loop；默认 deep_teach */
  reasoningMode: z.enum(['deep_teach', 'react']).optional(),
  /** 与 reasoningMode:'react' 等价的快捷开关 */
  toolsEnabled: z.boolean().optional(),
});

export type ExplainBody = z.infer<typeof explainSchemaFixed>;
export type ChatBody = z.infer<typeof chatSchema>;

export function createAgentOrchestrator(
  deps: AgentDeps,
  internal: {
    conversation: AgentConversation;
    hoverCache: HoverCache;
    memory: AgentMemory;
    toolLoop: ToolLoop;
  },
) {
  const { llm } = deps;
  const { conversation, hoverCache, memory, toolLoop } = internal;

  /** 空答案时极简重试一次（无记忆、关 thinking）；A-02：兜底重试走短超时 */
  async function retryHoverExplain(
    provider: ProviderConfig,
    userMsg: string,
  ): Promise<string> {
    try {
      const result = await llm.callLlm(
        {
          mode: 'fast',
          maxTokens: LLM_TOKEN_LIMITS.hoverRetry.maxTokens,
          temperature: LLM_TOKEN_LIMITS.hoverRetry.temperature,
          messages: [
            { role: 'system', content: buildHoverRetrySystem() },
            { role: 'user', content: userMsg.slice(0, 400) },
          ],
          signal: AbortSignal.timeout(HOVER_RETRY_TIMEOUT_MS),
        },
        provider,
      );
      const answer = extractHoverAnswer(result.thinking || '', result.text || '');
      if (answer && isSafeHoverPublicAnswer(answer)) {
        logger.info({ event: 'hover_retry_ok' }, 'hover retry ok');
        return answer;
      }
      logger.warn({ event: 'hover_retry_fail' }, 'hover retry fail');
      return '';
    } catch {
      logger.warn({ event: 'hover_retry_fail' }, 'hover retry fail');
      return '';
    }
  }

  /**
   * hover 答案门控 + 空时兜底重试（B-02：同步/流式共用同一触发语义）。
   * candidate 为已 extract 的候选答案；不安全置空，空则重试一次。
   */
  async function finalizeHoverAnswer(
    provider: ProviderConfig,
    userMsg: string,
    candidate: string,
    onRetry?: () => void,
  ): Promise<string> {
    let answer = candidate;
    if (answer && !isSafeHoverPublicAnswer(answer)) answer = '';
    if (!answer) {
      onRetry?.();
      answer = await retryHoverExplain(provider, userMsg);
    }
    return answer;
  }

  /** B-09：粗略 token 估算（中文 ~1.5 字/token，英文 ~0.25 词/token），用于历史预算 */
  function estimateTokens(s: string): number {
    const cn = (s.match(/[\u4e00-\u9fff]/g) || []).length;
    const rest = s.length - cn;
    return Math.ceil(cn / 1.5 + rest / 4);
  }

  /** B-09：历史块 token 预算——fast 600 / deep 2000，从最新向前累加 */
  const HISTORY_TOKEN_BUDGET = { fast: 600, deep: 2000 } as const;

  /**
   * B-02：chat 同步/流式共用上下文组装。
   * 历史按 mode 预算从最新向前累加（conv.summary 滚动摘要 + 最近消息，而非固定 12 条全文）。
   * reasoningMode=react / toolsEnabled → ReAct system + 真 tool-loop。
   */
  function resolveReactEnabled(body: ChatBody): boolean {
    return body.reasoningMode === 'react' || body.toolsEnabled === true;
  }

  async function prepareChat(body: ChatBody, userId: string | undefined) {
    const ctx = await memory.loadUserContext(userId, body.context?.route);
    // R-04：主备故障转移链（BYOK → 首选服务端 → 其余服务端）；provider 用于元信息/提示词，chain 用于调用
    const chain = llm.resolveProviderChain(ctx.byok);
    if (!chain.length) throw noProviderError();
    const provider = chain[0];

    const style = body.style || ctx.style;
    const mode = body.mode || 'deep';
    const reactEnabled = resolveReactEnabled(body);
    const conv = await conversation.ensureConversation(userId, {
      conversationId: body.conversationId,
      guestKey: body.guestKey,
    });
    const recent = await conversation.loadRecentMessages(conv.id);
    const budget = HISTORY_TOKEN_BUDGET[mode];
    const rows: string[] = [];
    let used = 0;
    for (const m of [...recent].reverse()) {
      const line = `${m.role}: ${m.content.slice(0, 400)}`;
      const t = estimateTokens(line);
      if (rows.length && used + t > budget) break;
      rows.push(line);
      used += t;
    }
    const historyBlock = rows.join('\n');
    const systemBase = reactEnabled
      ? buildReactSystem(style, ctx.memoryBlock)
      : mode === 'fast'
        ? buildHoverSystem(style, ctx.memoryBlock)
        : buildDeepSystem(style, ctx.memoryBlock);
    const system = [
      systemBase,
      conv.summary ? `【会话摘要】\n${conv.summary}` : '',
      historyBlock ? `【近期对话】\n${historyBlock}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const userContent = [
      body.message,
      body.context?.route ? `（当前路由 ${body.context.route}）` : '',
      body.context?.articleSlug ? `（文章 ${body.context.articleSlug}）` : '',
    ]
      .filter(Boolean)
      .join('\n');

    return { ctx, provider, chain, style, mode, reactEnabled, conv, system, userContent };
  }

  /** B-02：chat 同步/流式共用收尾——持久化、话题记忆、重要记忆 */
  async function finalizeChatTurn(
    convId: string,
    userId: string | undefined,
    userMsg: string,
    answer: string,
    thinking: string,
  ) {
    await conversation.persistTurn(convId, userMsg, { content: answer, thinking });
    void memory.rememberTopic(userId, userMsg, 'chat');
    void memory.maybeSaveImportantMemory(userId, userMsg, answer);
  }

  function llmError(err: unknown): AppError {
    // 业务 AppError（如 BYOK_URL_REJECTED / NO_PROVIDER）原样透传
    if (err instanceof AppError) return err;
    // A-01：上游错误带 URL/原文诊断字段——只进日志，客户端只见安全消息
    const info = llm.isLlmCallError(err) ? err : null;
    if (info) {
      logger.error(
        { err: info.diagnostic, status: info.status },
        'LLM call failed',
      );
      // 5xx 视为上游问题给 502；4xx 中的 400/422 已在 provider 内部处理
      return new AppError(502, 'LLM_ERROR', info.messageForClient);
    }
    logger.error(
      {
        err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { raw: String(err) },
      },
      'LLM call failed',
    );
    return new AppError(502, 'LLM_ERROR', '模型调用失败，请稍后重试');
  }

  function noProviderError(): AppError {
    return new AppError(
      400,
      'NO_PROVIDER',
      '未配置模型：请登录后在「设置 → BYOK」填写 Base URL、API Key、模型与 API 格式。',
    );
  }

  async function runExplain(body: ExplainBody, userId: string | undefined) {
    const ctx = await memory.loadUserContext(userId, body.selection.route);
    // R-04：主备故障转移链；provider 用于元信息/提示词，chain 用于调用
    const chain = llm.resolveProviderChain(ctx.byok);
    if (!chain.length) throw noProviderError();
    const provider = chain[0];

    const style = body.style || ctx.style;
    const isHover = body.mode === 'hover';
    const system = isHover
      ? buildHoverSystem(style, ctx.memoryBlock)
      : buildDeepSystem(style, ctx.memoryBlock);

    const topic = body.selection.title
      ? `${body.selection.title}\n${body.selection.text}`
      : body.selection.text;

    // 悬停 user 只给知识点，约束放在 system，避免模型复述「要2-3句…」（bug-4）
    const userMsg = isHover
      ? [
          (body.selection.title || '').trim() || topic.slice(0, 200),
          body.selection.text &&
          body.selection.text.trim() &&
          body.selection.text.trim() !== (body.selection.title || '').trim()
            ? body.selection.text.trim().slice(0, 280)
            : '',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          `【待讲解片段】\n${topic}`,
          body.selection.context ? `【所在段落/上下文】\n${body.selection.context}` : '',
          body.selection.route ? `页面：${body.selection.route}` : '',
          body.selection.articleSlug ? `文章：${body.selection.articleSlug}` : '',
          '请针对该知识点详细讲解，按 ReAct 风格结构输出。',
        ]
          .filter(Boolean)
          .join('\n\n');

    return {
      provider,
      chain,
      style,
      isHover,
      system,
      userMsg,
      topic: body.selection.text,
      mode: body.mode,
    };
  }

  /**
   * R-06：悬停缓存命中策略——同步/流式端点共用。
   * 先按默认风格预查（可跳过 Provider 解析，缓存即降级层）；
   * 未命中且已解析出真实风格（prep）且风格不同，再按真实风格二查一次。
   */
  async function resolveHoverCacheHit(
    body: ExplainBody,
    prep?: Pick<ExplainPrep, 'isHover' | 'topic' | 'style'>,
  ): Promise<{ style: string; answer: string } | null> {
    if (body.mode !== 'hover') return null;
    const preStyle = body.style || 'professional'; // 与 loadUserContext 默认风格一致
    const preCached = await hoverCache.getHoverCacheSafe(body.selection.text, preStyle);
    if (preCached) return { style: preStyle, answer: preCached };
    if (!prep?.isHover) return null;
    const preChecked = preStyle === prep.style;
    if (preChecked) return null;
    const cached = await hoverCache.getHoverCacheSafe(prep.topic, prep.style);
    return cached ? { style: prep.style, answer: cached } : null;
  }

  return {
    retryHoverExplain,
    finalizeHoverAnswer,
    estimateTokens,
    resolveReactEnabled,
    prepareChat,
    finalizeChatTurn,
    llmError,
    noProviderError,
    runExplain,
    resolveHoverCacheHit,
    toolLoop,
    memory,
  };
}

export type ExplainPrep = Awaited<ReturnType<ReturnType<typeof createAgentOrchestrator>['runExplain']>>;
export type AgentOrchestrator = ReturnType<typeof createAgentOrchestrator>;
