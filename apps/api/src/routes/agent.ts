import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { logger } from '../lib/logger.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { AppError, badRequest } from '../lib/errors.js';
import {
  callLlm,
  getDefaultProvider,
  listPublicProviders,
  LlmCallError,
  resolveProvider,
  streamLlm,
} from '../lib/llm/providers.js';
import {
  AGENT_MODE_META,
  buildDeepSystem,
  buildHoverRetrySystem,
  buildHoverSystem,
  extractHoverAnswer,
  extractVisibleAnswer,
  isSafeHoverPublicAnswer,
  looksLikeHoverPlanning,
} from '../lib/llm/agentPrompt.js';
import type { ByokConfig, ProviderConfig } from '../lib/llm/types.js';
import { HOVER_RETRY_TIMEOUT_MS, LLM_TOKEN_LIMITS } from '../lib/llm/config.js';
import { parsePrefs } from '../lib/prefs.js';
import { getHoverCache, setHoverCache } from '../services/hoverCache.js';
import {
  ensureConversation,
  loadRecentMessages,
  persistTurn,
} from '../services/agentConversation.js';
import {
  loadUserContext,
  maybeSaveImportantMemory,
  rememberTopic,
} from '../services/agentMemory.js';
import { initSse, softStreamHoverAnswer, sseWrite } from '../lib/sse.js';

export const agentRouter = Router();

const explainSchemaFixed = z.object({
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

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  conversationId: z.string().max(64).optional(),
  context: z
    .object({
      route: z.string().max(300).optional(),
      articleSlug: z.string().max(120).optional(),
      sectionId: z.string().max(120).optional(),
    })
    .optional(),
  style: z.string().max(40).optional(),
  mode: z.enum(['fast', 'deep']).optional(),
});

/** 空答案时极简重试一次（无记忆、关 thinking）；A-02：兜底重试走短超时 */
async function retryHoverExplain(
  provider: ProviderConfig,
  userMsg: string,
): Promise<string> {
  try {
    const result = await callLlm(
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
 */
async function prepareChat(body: z.infer<typeof chatSchema>, userId: string | undefined) {
  const ctx = await loadUserContext(userId, body.context?.route);
  const provider = resolveProvider(ctx.byok);
  if (!provider) throw noProviderError();

  const style = body.style || ctx.style;
  const mode = body.mode || 'deep';
  const conv = await ensureConversation(userId, body.conversationId);
  const recent = await loadRecentMessages(conv.id);
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
  const systemBase =
    mode === 'fast'
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

  return { ctx, provider, style, mode, conv, system, userContent };
}

/** B-02：chat 同步/流式共用收尾——持久化、话题记忆、重要记忆 */
async function finalizeChatTurn(
  convId: string,
  userId: string | undefined,
  userMsg: string,
  answer: string,
  thinking: string,
) {
  await persistTurn(convId, userMsg, { content: answer, thinking });
  void rememberTopic(userId, userMsg, 'chat');
  void maybeSaveImportantMemory(userId, userMsg, answer);
}

function llmError(err: unknown): AppError {
  // A-01：上游错误带 URL/原文诊断字段——只进日志，客户端只见安全消息
  if (err instanceof LlmCallError) {
    logger.error(
      { err: err.diagnostic, status: err.status },
      'LLM call failed',
    );
    // 5xx 视为上游问题给 502；4xx 中的 400/422 已在 provider 内部处理
    return new AppError(502, 'LLM_ERROR', err.messageForClient);
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

agentRouter.get('/meta', (_req, res) => {
  res.json({
    modes: AGENT_MODE_META,
    formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
  });
});

/**
 * 清除悬停 Agent 服务端缓存（L2）。
 * 清除后所有卡片/气泡讲解均需重新调用 LLM，不再命中历史脏数据。
 */
agentRouter.post('/cache/clear', requireAuth, requireRole('admin'), async (_req, res, next) => {
  try {
    const result = await prisma.hoverExplainCache.deleteMany({});
    res.json({
      ok: true,
      cleared: result.count,
      scope: 'hover-explain-l2',
      message: `已清除 ${result.count} 条悬停讲解缓存`,
    });
  } catch (e) {
    next(e);
  }
});

agentRouter.get('/providers', optionalAuth, async (req, res, next) => {
  try {
    let byokEnabled = false;
    if (req.user) {
      const user = await prisma.user.findUnique({ where: { id: req.user.id } });
      const pref = parsePrefs(user?.preferences);
      byokEnabled = Boolean((pref.byok as ByokConfig | undefined)?.enabled);
    }
    res.json({
      providers: listPublicProviders(),
      defaultId: getDefaultProvider()?.id || null,
      formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
      byokEnabled,
      modes: AGENT_MODE_META,
    });
  } catch (e) {
    next(e);
  }
});

async function runExplain(
  body: z.infer<typeof explainSchemaFixed>,
  userId: string | undefined,
) {
  const ctx = await loadUserContext(userId, body.selection.route);
  const provider = resolveProvider(ctx.byok);
  if (!provider) throw noProviderError();

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
    style,
    isHover,
    system,
    userMsg,
    topic: body.selection.text,
    mode: body.mode,
  };
}

agentRouter.post('/explain', optionalAuth, validate(explainSchemaFixed), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof explainSchemaFixed>;
    const prep = await runExplain(body, req.user?.id);

    if (prep.isHover) {
      const cached = await getHoverCache(prep.topic, prep.style);
      if (cached) {
        res.json({
          explanation: cached,
          mode: body.mode,
          model: 'cache',
          format: 'cache',
          style: prep.style,
          providerId: 'hover-cache',
          cached: true,
          meta: AGENT_MODE_META.fast,
        });
        return;
      }
    }

    let result;
    try {
      result = await callLlm(
        {
          mode: prep.isHover ? 'fast' : 'deep',
          maxTokens: prep.isHover ? 220 : 2048,
          temperature: prep.isHover ? 0.15 : undefined,
          messages: [
            { role: 'system', content: prep.system },
            { role: 'user', content: prep.userMsg },
          ],
        },
        prep.provider,
      );
    } catch (e) {
      throw llmError(e);
    }
    let explanation = prep.isHover
      ? extractHoverAnswer(result.thinking || '', result.text || '')
      : extractVisibleAnswer(result.thinking || '', result.text || '').answer;
    if (prep.isHover) {
      explanation = await finalizeHoverAnswer(prep.provider, prep.userMsg, explanation);
      if (explanation) void setHoverCache(prep.topic, prep.style, explanation);
    } else if (explanation && looksLikeHoverPlanning(explanation)) {
      // A-04：deep 正文命中策划特征时留痕（深度讲解允许较长，不强制清空）
      logger.warn({ event: 'deep_planning_leak', mode: body.mode }, 'deep answer looks like planning');
    }
    void rememberTopic(req.user?.id, prep.topic, body.mode);
    res.json({
      explanation,
      mode: body.mode,
      model: result.model,
      format: result.format,
      style: prep.style,
      providerId: prep.provider.id,
      cached: false,
      meta: prep.isHover ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
    });
  } catch (e) {
    next(e);
  }
});

agentRouter.post(
  '/explain/stream',
  optionalAuth,
  validate(explainSchemaFixed),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof explainSchemaFixed>;
      const prep = await runExplain(body, req.user?.id);
      initSse(res);

      if (prep.isHover) {
        const cached = await getHoverCache(prep.topic, prep.style);
        if (cached) {
          sseWrite(res, {
            type: 'meta',
            model: 'cache',
            format: 'cache',
            providerId: 'hover-cache',
            mode: body.mode,
            style: prep.style,
            cached: true,
            meta: AGENT_MODE_META.fast,
          });
          sseWrite(res, { type: 'final', answer: cached, thinking: '' });
          sseWrite(res, { type: 'done' });
          res.end();
          return;
        }
      }

      sseWrite(res, {
        type: 'meta',
        model: prep.provider.model,
        format: prep.provider.format,
        providerId: prep.provider.id,
        mode: body.mode,
        style: prep.style,
        meta: prep.isHover ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
      });
      try {
        let thinkingAcc = '';
        let textAcc = '';
        /**
         * 悬停硬规则：
         * 1) 生成过程中：thinking/text 只服务端累计，客户端只收 status:thinking
         * 2) 累计中周期性 extract；一旦得到 ≥2 句安全讲解 → 早停上游 LLM
         * 3) 结束后仍空 → 极简重试一次；再空则 final.answer=""（前端失败态）
         * 4) 仅把安全讲解 soft-stream 为 delta；final.thinking 恒 ""
         */
        let lastHoverStatusAt = 0;
        let lastProbeAt = 0;
        let lastProbeLen = 0;
        let earlyAnswer = '';
        const llmAbort = new AbortController();
        // 客户端断开时取消上游
        req.on('close', () => {
          if (!res.writableEnded) llmAbort.abort();
        });

        const emitHoverThinkingStatus = () => {
          const now = Date.now();
          if (now - lastHoverStatusAt < 100) return;
          lastHoverStatusAt = now;
          sseWrite(res, { type: 'status', status: 'thinking' });
        };

        const probeEarlyAnswer = () => {
          if (!prep.isHover || earlyAnswer) return;
          const total = thinkingAcc.length + textAcc.length;
          const now = Date.now();
          if (now - lastProbeAt < 220 && total - lastProbeLen < 60) return;
          lastProbeAt = now;
          lastProbeLen = total;
          const candidate = extractHoverAnswer(thinkingAcc, textAcc);
          // 早停要求至少 2 句，避免半截单句抢跑
          const n = (candidate.match(/[。！]/g) || []).length;
          if (candidate && n >= 2 && isSafeHoverPublicAnswer(candidate)) {
            earlyAnswer = candidate;
            // B-06：早停命中打点（省 token 的可观测性）
            logger.info(
              { event: 'hover_early_stop', topic: prep.topic.slice(0, 60), chars: total },
              'hover early stop',
            );
            llmAbort.abort();
          }
        };

        try {
          for await (const chunk of streamLlm(
            {
              mode: prep.isHover ? 'fast' : 'deep',
              maxTokens: prep.isHover ? 220 : 2048,
              temperature: prep.isHover ? 0.15 : undefined,
              signal: prep.isHover ? llmAbort.signal : undefined,
              messages: [
                { role: 'system', content: prep.system },
                { role: 'user', content: prep.userMsg },
              ],
            },
            prep.provider,
          )) {
            if (res.writableEnded || res.destroyed) {
              llmAbort.abort();
              return;
            }
            if (earlyAnswer) break;
            if (chunk.kind === 'thinking') {
              thinkingAcc += chunk.text;
              if (prep.isHover) {
                emitHoverThinkingStatus();
                probeEarlyAnswer();
              } else {
                sseWrite(res, { type: 'thinking', text: chunk.text });
              }
            } else {
              textAcc += chunk.text;
              if (prep.isHover) {
                emitHoverThinkingStatus();
                probeEarlyAnswer();
              } else {
                sseWrite(res, { type: 'delta', text: chunk.text });
              }
            }
          }
        } catch (e) {
          // 早停 abort 为预期；其它错误上抛到外层
          if (!(e instanceof Error && e.name === 'AbortError') && !earlyAnswer && !llmAbort.signal.aborted) {
            throw e;
          }
        }
        if (res.writableEnded || res.destroyed) {
          return;
        }
        if (prep.isHover) {
          const answer = await finalizeHoverAnswer(
            prep.provider,
            prep.userMsg,
            earlyAnswer || extractHoverAnswer(thinkingAcc, textAcc),
            () => sseWrite(res, { type: 'status', status: 'thinking' }),
          );
          if (answer) {
            void setHoverCache(prep.topic, prep.style, answer);
            await softStreamHoverAnswer(res, answer, 36);
          }
          sseWrite(res, {
            type: 'final',
            answer: answer || '',
            thinking: '',
            complete: Boolean(answer),
          });
        } else {
          const visible = extractVisibleAnswer(thinkingAcc, textAcc);
          // A-04：deep 正文命中策划特征时留痕（不强制清空）
          if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
            logger.warn(
              { event: 'deep_planning_leak', mode: body.mode },
              'deep answer looks like planning',
            );
          }
          sseWrite(res, {
            type: 'final',
            answer: visible.answer,
            thinking: visible.thinking,
          });
        }
        sseWrite(res, { type: 'done' });
        void rememberTopic(req.user?.id, prep.topic, body.mode);
      } catch (e) {
        if (!(e instanceof Error && e.name === 'AbortError') && !res.writableEnded && !res.destroyed) {
          // A-01：SSE 错误消息只发安全文案，不泄露 url/raw
          const message = e instanceof LlmCallError ? e.messageForClient : '讲解生成失败，请稍后重试';
          sseWrite(res, { type: 'error', message });
        }
      } finally {
        // B-10：统一收尾，避免 res.end() 重复调用
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            /* 已关闭 */
          }
        }
      }
    } catch (e) {
      next(e);
    }
  },
);

agentRouter.post('/chat', optionalAuth, validate(chatSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof chatSchema>;
    const { provider, style, mode, conv, system, userContent } = await prepareChat(
      body,
      req.user?.id,
    );
    const limits = LLM_TOKEN_LIMITS[mode === 'fast' ? 'chatFast' : 'chatDeep'];

    let result;
    try {
      result = await callLlm(
        {
          mode,
          maxTokens: limits.maxTokens,
          temperature: limits.temperature,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
        },
        provider,
      );
    } catch (e) {
      throw llmError(e);
    }

    const visible = extractVisibleAnswer(result.thinking || '', result.text || '');
    // A-04：deep 正文命中策划特征时留痕（不强制清空）
    if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
      logger.warn({ event: 'deep_planning_leak', mode }, 'deep answer looks like planning');
    }
    await finalizeChatTurn(conv.id, req.user?.id, body.message, visible.answer, visible.thinking);

    res.json({
      reply: visible.answer,
      thinking: visible.thinking,
      conversationId: conv.id,
      model: result.model,
      format: result.format,
      style,
      providerId: provider.id,
      meta: mode === 'fast' ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
    });
  } catch (e) {
    next(e);
  }
});

agentRouter.post('/chat/stream', optionalAuth, validate(chatSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof chatSchema>;
    const { provider, style, mode, conv, system, userContent } = await prepareChat(
      body,
      req.user?.id,
    );
    const limits = LLM_TOKEN_LIMITS[mode === 'fast' ? 'chatFast' : 'chatDeep'];

    initSse(res);
    sseWrite(res, {
      type: 'meta',
      model: provider.model,
      format: provider.format,
      providerId: provider.id,
      mode,
      style,
      conversationId: conv.id,
      meta: mode === 'fast' ? AGENT_MODE_META.fast : AGENT_MODE_META.deep,
    });

    try {
      let thinkingAcc = '';
      let textAcc = '';
      const llmAbort = new AbortController();
      // 客户端断开时取消上游 LLM，避免 token 空转
      req.on('close', () => {
        if (!res.writableEnded) llmAbort.abort();
      });

      try {
        for await (const chunk of streamLlm(
          {
            mode,
            maxTokens: limits.maxTokens,
            temperature: limits.temperature,
            signal: llmAbort.signal,
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: userContent },
            ],
          },
          provider,
        )) {
          // 客户端已断开：停止生成，且不入库
          if (res.writableEnded || res.destroyed || llmAbort.signal.aborted) {
            llmAbort.abort();
            return;
          }
          if (chunk.kind === 'thinking') {
            thinkingAcc += chunk.text;
            if (mode === 'fast') {
              sseWrite(res, { type: 'status', status: 'thinking' });
            } else {
              sseWrite(res, { type: 'thinking', text: chunk.text });
            }
          } else {
            textAcc += chunk.text;
            if (mode === 'fast') {
              sseWrite(res, { type: 'status', status: 'thinking' });
            } else {
              sseWrite(res, { type: 'delta', text: chunk.text });
            }
          }
        }
      } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (llmAbort.signal.aborted || res.writableEnded || res.destroyed) return;
        throw e;
      }

      if (res.writableEnded || res.destroyed || llmAbort.signal.aborted) {
        return;
      }
      const visible = extractVisibleAnswer(thinkingAcc, textAcc);
      // A-04：deep 正文命中策划特征时留痕（不强制清空）
      if (visible.answer && looksLikeHoverPlanning(visible.answer)) {
        logger.warn({ event: 'deep_planning_leak', mode }, 'deep answer looks like planning');
      }
      if (mode === 'fast') {
        sseWrite(res, { type: 'final', answer: visible.answer, thinking: '' });
      } else {
        sseWrite(res, {
          type: 'final',
          answer: visible.answer,
          thinking: visible.thinking,
        });
      }
      sseWrite(res, { type: 'done' });
      await finalizeChatTurn(conv.id, req.user?.id, body.message, visible.answer, visible.thinking);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError') && !res.writableEnded && !res.destroyed) {
        // A-01：SSE 错误消息只发安全文案，不泄露 url/raw
        const message = e instanceof LlmCallError ? e.messageForClient : '生成失败，请稍后重试';
        sseWrite(res, { type: 'error', message });
      }
    } finally {
      // B-10：统一收尾，避免 res.end() 重复调用
      if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* 已关闭 */
        }
      }
    }
  } catch (e) {
    next(e);
  }
});

agentRouter.get('/memory', requireAuth, async (req, res, next) => {
  try {
    const items = await prisma.agentMemory.findMany({
      where: { userId: req.user!.id },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    res.json({ items });
  } catch (e) {
    next(e);
  }
});

agentRouter.post(
  '/memory',
  requireAuth,
  validate(
    z.object({
      key: z.string().min(1).max(120),
      value: z.string().min(1).max(2000),
      kind: z.string().max(40).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const { key, value, kind } = req.body as { key: string; value: string; kind?: string };
      const item = await prisma.agentMemory.upsert({
        where: { userId_key: { userId: req.user!.id, key } },
        create: { userId: req.user!.id, key, value, kind: kind || 'fact' },
        update: { value, kind: kind || 'fact' },
      });
      res.json({ item });
    } catch (e) {
      next(e);
    }
  },
);

agentRouter.post(
  '/progress',
  requireAuth,
  validate(
    z.object({
      articleSlug: z.string().min(1),
      progress: z.number().min(0).max(1).optional(),
      mastery: z.enum(['not_started', 'learning', 'mastered']).optional(),
    }),
  ),
  async (req, res, next) => {
    try {
      const body = req.body as {
        articleSlug: string;
        progress?: number;
        mastery?: string;
      };
      const article = await prisma.article.findUnique({ where: { slug: body.articleSlug } });
      if (!article) throw badRequest('文章不存在');
      const existing = await prisma.learningProgress.findUnique({
        where: { userId_articleId: { userId: req.user!.id, articleId: article.id } },
      });
      const nextProgress =
        body.progress == null
          ? (existing?.progress ?? 0.3)
          : Math.max(existing?.progress ?? 0, body.progress);
      // mastered 不可降级；其余以请求为准（缺省保留或 learning）
      let nextMastery = body.mastery || existing?.mastery || 'learning';
      if (existing?.mastery === 'mastered' && nextMastery !== 'mastered') {
        nextMastery = 'mastered';
      }
      const item = await prisma.learningProgress.upsert({
        where: {
          userId_articleId: { userId: req.user!.id, articleId: article.id },
        },
        create: {
          userId: req.user!.id,
          articleId: article.id,
          progress: body.progress ?? 0.3,
          mastery: body.mastery || 'learning',
        },
        update: {
          progress: nextProgress,
          mastery: nextMastery,
        },
      });
      if (nextMastery === 'mastered') {
        await prisma.agentMemory.upsert({
          where: {
            userId_key: { userId: req.user!.id, key: `mastered:${article.slug}` },
          },
          create: {
            userId: req.user!.id,
            key: `mastered:${article.slug}`,
            value: `已掌握文章《${article.title}》`,
            kind: 'skill',
          },
          update: { value: `已掌握文章《${article.title}》`, kind: 'skill' },
        });
      }
      res.json({ item });
    } catch (e) {
      next(e);
    }
  },
);
