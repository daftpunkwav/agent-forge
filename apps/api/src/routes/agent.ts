import { createHash } from 'node:crypto';
import { Router, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { AppError, badRequest } from '../lib/errors.js';
import {
  callLlm,
  getDefaultProvider,
  listPublicProviders,
  resolveProvider,
  streamLlm,
} from '../lib/llm/providers.js';
import {
  AGENT_MODE_META,
  buildDeepSystem,
  buildHoverSystem,
  extractHoverAnswer,
  extractVisibleAnswer,
  formatMemoryBlock,
  isCompleteHoverAnswer,
  looksLikeHoverPlanning,
} from '../lib/llm/agentPrompt.js';
import type { ByokConfig } from '../lib/llm/types.js';

export const agentRouter = Router();

/**
 * 悬停缓存（工业级两层语义，此处为 L2 服务端）
 * - 默认 TTL 2h：热区会话复用、控制成本
 * - 高命中（hits≥8）延长至 24h：热点知识点少打 LLM
 * - 超过 hard cap 一律失效；写库前 isCompleteHoverAnswer 质检
 * - 仅缓存完整 final，中断/半截永不入库
 */
const HOVER_CACHE_TTL_DEFAULT_MS = 2 * 60 * 60 * 1000;
const HOVER_CACHE_TTL_HOT_MS = 24 * 60 * 60 * 1000;
const HOVER_CACHE_HOT_HITS = 8;

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

function hoverCacheKey(topic: string, style: string): string {
  const norm = topic.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400);
  return createHash('sha256').update(`${style}::${norm}`).digest('hex').slice(0, 48);
}

async function getHoverCache(topic: string, style: string): Promise<string | null> {
  const key = hoverCacheKey(topic, style);
  const row = await prisma.hoverExplainCache.findUnique({ where: { cacheKey: key } });
  if (!row) return null;
  // 质检：历史脏数据直接删掉，避免半截答案反复命中
  if (!isCompleteHoverAnswer(row.answer)) {
    void prisma.hoverExplainCache.delete({ where: { cacheKey: key } }).catch(() => undefined);
    return null;
  }
  const age = Date.now() - row.updatedAt.getTime();
  const ttl = row.hits >= HOVER_CACHE_HOT_HITS ? HOVER_CACHE_TTL_HOT_MS : HOVER_CACHE_TTL_DEFAULT_MS;
  if (age > ttl) return null;
  void prisma.hoverExplainCache
    .update({ where: { cacheKey: key }, data: { hits: { increment: 1 } } })
    .catch(() => undefined);
  return row.answer;
}

async function setHoverCache(topic: string, style: string, answer: string) {
  if (!isCompleteHoverAnswer(answer)) return;
  const key = hoverCacheKey(topic, style);
  await prisma.hoverExplainCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, topic: topic.slice(0, 200), answer: answer.slice(0, 1200) },
    update: { answer: answer.slice(0, 1200), topic: topic.slice(0, 200) },
  });
}

async function ensureConversation(userId: string | undefined, conversationId?: string) {
  if (conversationId) {
    const existing = await prisma.agentConversation.findUnique({ where: { id: conversationId } });
    if (existing && (!userId || existing.userId === userId || !existing.userId)) {
      return existing;
    }
  }
  return prisma.agentConversation.create({
    data: {
      userId: userId || null,
      title: '对话',
    },
  });
}

async function loadRecentMessages(conversationId: string, take = 12) {
  return prisma.agentMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take,
  });
}

async function persistTurn(
  conversationId: string,
  userMsg: string,
  assistant: { content: string; thinking?: string },
) {
  await prisma.agentMessage.createMany({
    data: [
      { conversationId, role: 'user', content: userMsg.slice(0, 4000) },
      {
        conversationId,
        role: 'assistant',
        content: assistant.content.slice(0, 8000),
        thinking: (assistant.thinking || '').slice(0, 4000),
      },
    ],
  });
  // 滚动摘要：超过 20 条时压缩最旧事实
  const count = await prisma.agentMessage.count({ where: { conversationId } });
  if (count > 24) {
    const old = await prisma.agentMessage.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: 8,
    });
    const snippet = old
      .map((m) => `${m.role}: ${m.content.slice(0, 80)}`)
      .join(' | ')
      .slice(0, 500);
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { summary: snippet, updatedAt: new Date() },
    });
  } else {
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }
}

async function maybeSaveImportantMemory(userId: string | undefined, userMsg: string, answer: string) {
  if (!userId) return;
  // 用户明确要求记住 / 偏好
  if (/请记住|记住：|我的偏好|以后.*用/.test(userMsg)) {
    const key = `pref:${userMsg.slice(0, 40)}`;
    await prisma.agentMemory.upsert({
      where: { userId_key: { userId, key } },
      create: {
        userId,
        key,
        value: `${userMsg.slice(0, 120)} → ${answer.slice(0, 200)}`,
        kind: 'preference',
      },
      update: { value: `${userMsg.slice(0, 120)} → ${answer.slice(0, 200)}` },
    });
  }
}

function parsePrefs(raw?: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function loadUserContext(userId?: string, route?: string) {
  if (!userId) {
    return {
      style: 'professional',
      memoryBlock: formatMemoryBlock({
        mastered: [],
        learning: [],
        notes: [],
        route,
      }),
      byok: null as ByokConfig | null,
    };
  }
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const pref = parsePrefs(user?.preferences);
  const style = (typeof pref.agentStyle === 'string' && pref.agentStyle) || 'professional';
  const byok = (pref.byok as ByokConfig) || null;

  const [memories, progress] = await Promise.all([
    prisma.agentMemory.findMany({ where: { userId }, take: 40, orderBy: { updatedAt: 'desc' } }),
    prisma.learningProgress.findMany({
      where: { userId },
      include: { article: { select: { title: true, slug: true } } },
      take: 50,
    }),
  ]);

  const mastered = progress
    .filter((p) => p.mastery === 'mastered' || p.progress >= 0.85)
    .map((p) => p.article.title);
  const learning = progress
    .filter((p) => p.mastery !== 'mastered' && p.progress < 0.85)
    .map((p) => p.article.title);
  const notes = memories
    .filter((m) => m.kind !== 'fact' || !m.key.startsWith('seen:'))
    .map((m) => `${m.key}: ${m.value.slice(0, 120)}`);
  const recentTopics = memories
    .filter((m) => m.key.startsWith('seen:'))
    .map((m) => m.value.replace(/^用户.*?：/, '').slice(0, 40))
    .slice(0, 8);

  return {
    style,
    byok,
    memoryBlock: formatMemoryBlock({
      style,
      mastered,
      learning,
      notes,
      recentTopics,
      route,
    }),
  };
}

async function rememberTopic(userId: string | undefined, topic: string, mode: string) {
  if (!userId || !topic.trim()) return;
  const key = `seen:${topic.slice(0, 80)}`;
  await prisma.agentMemory.upsert({
    where: { userId_key: { userId, key } },
    create: {
      userId,
      key,
      value: `用户在 ${mode} 模式询问过：${topic.slice(0, 200)}`,
      kind: 'fact',
    },
    update: {
      value: `用户再次询问（${mode}）：${topic.slice(0, 200)}`,
      kind: 'fact',
    },
  });
}

function llmError(err: unknown): AppError {
  const msg = err instanceof Error ? err.message : String(err);
  return new AppError(502, 'LLM_ERROR', msg);
}

function noProviderError(): AppError {
  return new AppError(
    400,
    'NO_PROVIDER',
    '未配置模型：请登录后在「设置 → BYOK」填写 Base URL、API Key、模型与 API 格式。',
  );
}

function initSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
}

function sseWrite(res: Response, obj: unknown) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

agentRouter.get('/meta', (_req, res) => {
  res.json({
    modes: AGENT_MODE_META,
    formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
  });
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

  const userMsg = [
    `【待讲解片段】\n${topic}`,
    body.selection.context ? `【所在段落/上下文】\n${body.selection.context}` : '',
    body.selection.route ? `页面：${body.selection.route}` : '',
    body.selection.articleSlug ? `文章：${body.selection.articleSlug}` : '',
    isHover
      ? '请针对「待讲解片段」快速讲解，不要展开全文。'
      : '请针对该知识点详细讲解，按 ReAct 风格结构输出。',
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
          maxTokens: prep.isHover ? 700 : 2048,
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
    const explanation = prep.isHover
      ? extractHoverAnswer(result.thinking || '', result.text || '')
      : extractVisibleAnswer(result.thinking || '', result.text || '').answer;
    if (prep.isHover && explanation) void setHoverCache(prep.topic, prep.style, explanation);
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
        for await (const chunk of streamLlm(
          {
            mode: prep.isHover ? 'fast' : 'deep',
            maxTokens: prep.isHover ? 700 : 2048,
            messages: [
              { role: 'system', content: prep.system },
              { role: 'user', content: prep.userMsg },
            ],
          },
          prep.provider,
        )) {
          // 客户端已断开：停止生成，且不写缓存
          if (res.writableEnded || res.destroyed) {
            return;
          }
          if (chunk.kind === 'thinking') {
            thinkingAcc += chunk.text;
            // 悬停：思考通道只作状态，绝不推思考正文
            if (prep.isHover) {
              sseWrite(res, { type: 'status', status: 'thinking' });
            } else {
              sseWrite(res, { type: 'thinking', text: chunk.text });
            }
          } else {
            textAcc += chunk.text;
            if (prep.isHover) {
              // 悬停流式：仅推送看起来像正文的分片
              if (!looksLikeHoverPlanning(textAcc)) {
                sseWrite(res, { type: 'delta', text: chunk.text });
              } else {
                sseWrite(res, { type: 'status', status: 'thinking' });
              }
            } else {
              sseWrite(res, { type: 'delta', text: chunk.text });
            }
          }
        }
        if (res.writableEnded || res.destroyed) {
          return;
        }
        if (prep.isHover) {
          let answer = extractHoverAnswer(thinkingAcc, textAcc);
          // 仍空：从 text 做最后兜底（已滤策划）
          if (!answer && textAcc.trim() && !looksLikeHoverPlanning(textAcc)) {
            answer = textAcc.trim().slice(0, 560);
          }
          if (answer && isCompleteHoverAnswer(answer)) {
            void setHoverCache(prep.topic, prep.style, answer);
          }
          sseWrite(res, {
            type: 'final',
            answer: answer || '',
            thinking: '', // 悬停永不暴露 thinking
            complete: Boolean(answer),
          });
        } else {
          const visible = extractVisibleAnswer(thinkingAcc, textAcc);
          sseWrite(res, {
            type: 'final',
            answer: visible.answer,
            thinking: visible.thinking,
          });
        }
        sseWrite(res, { type: 'done' });
        void rememberTopic(req.user?.id, prep.topic, body.mode);
      } catch (e) {
        sseWrite(res, {
          type: 'error',
          message: e instanceof Error ? e.message : String(e),
        });
      }
      res.end();
    } catch (e) {
      next(e);
    }
  },
);

agentRouter.post('/chat', optionalAuth, validate(chatSchema), async (req, res, next) => {
  try {
    const body = req.body as z.infer<typeof chatSchema>;
    const ctx = await loadUserContext(req.user?.id, body.context?.route);
    const provider = resolveProvider(ctx.byok);
    if (!provider) throw noProviderError();

    const style = body.style || ctx.style;
    const mode = body.mode || 'deep';
    const conv = await ensureConversation(req.user?.id, body.conversationId);
    const recent = await loadRecentMessages(conv.id);
    const historyBlock = recent
      .reverse()
      .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
      .join('\n');
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

    let result;
    try {
      result = await callLlm(
        {
          mode,
          maxTokens: mode === 'fast' ? 700 : 2048,
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
    await persistTurn(conv.id, body.message, {
      content: visible.answer,
      thinking: visible.thinking,
    });
    void rememberTopic(req.user?.id, body.message, 'chat');
    void maybeSaveImportantMemory(req.user?.id, body.message, visible.answer);

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
    const ctx = await loadUserContext(req.user?.id, body.context?.route);
    const provider = resolveProvider(ctx.byok);
    if (!provider) throw noProviderError();

    const style = body.style || ctx.style;
    const mode = body.mode || 'deep';
    const conv = await ensureConversation(req.user?.id, body.conversationId);
    const recent = await loadRecentMessages(conv.id);
    const historyBlock = recent
      .reverse()
      .map((m) => `${m.role}: ${m.content.slice(0, 400)}`)
      .join('\n');
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
      for await (const chunk of streamLlm(
        {
          mode,
          maxTokens: mode === 'fast' ? 500 : 2048,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userContent },
          ],
        },
        provider,
      )) {
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
      const visible = extractVisibleAnswer(thinkingAcc, textAcc);
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
      await persistTurn(conv.id, body.message, {
        content: visible.answer,
        thinking: visible.thinking,
      });
      void rememberTopic(req.user?.id, body.message, 'chat');
      void maybeSaveImportantMemory(req.user?.id, body.message, visible.answer);
    } catch (e) {
      sseWrite(res, {
        type: 'error',
        message: e instanceof Error ? e.message : String(e),
      });
    }
    res.end();
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
          progress: body.progress,
          mastery: body.mastery,
        },
      });
      if (body.mastery === 'mastered') {
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
