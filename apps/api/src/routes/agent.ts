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
  extractVisibleAnswer,
  formatMemoryBlock,
} from '../lib/llm/agentPrompt.js';
import type { ByokConfig } from '../lib/llm/types.js';

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
    void rememberTopic(req.user?.id, prep.topic, body.mode);
    res.json({
      explanation: result.text,
      mode: body.mode,
      model: result.model,
      format: result.format,
      style: prep.style,
      providerId: prep.provider.id,
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
            maxTokens: prep.isHover ? 500 : 2048,
            messages: [
              { role: 'system', content: prep.system },
              { role: 'user', content: prep.userMsg },
            ],
          },
          prep.provider,
        )) {
          if (chunk.kind === 'thinking') {
            thinkingAcc += chunk.text;
            // 悬停模式不把思考内容推给前端，只发状态
            if (prep.isHover) {
              sseWrite(res, { type: 'status', status: 'thinking' });
            } else {
              sseWrite(res, { type: 'thinking', text: chunk.text });
            }
          } else {
            textAcc += chunk.text;
            // 悬停：等 final 再给正文，避免半成品/思考泄漏
            if (!prep.isHover) {
              sseWrite(res, { type: 'delta', text: chunk.text });
            } else {
              sseWrite(res, { type: 'status', status: 'thinking' });
            }
          }
        }
        const visible = extractVisibleAnswer(thinkingAcc, textAcc);
        // 悬停：只推精炼最终答案；助手：推 final 覆盖清洗后的答案
        if (prep.isHover) {
          if (visible.answer) {
            sseWrite(res, { type: 'delta', text: visible.answer });
          }
          sseWrite(res, {
            type: 'final',
            answer: visible.answer,
            thinking: '', // 悬停永不暴露思考
          });
        } else {
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
    const system =
      mode === 'fast'
        ? buildHoverSystem(style, ctx.memoryBlock)
        : buildDeepSystem(style, ctx.memoryBlock);

    let result;
    try {
      result = await callLlm(
        {
          mode,
          maxTokens: mode === 'fast' ? 700 : 2048,
          messages: [
            { role: 'system', content: system },
            {
              role: 'user',
              content: [
                body.message,
                body.context?.route ? `（当前路由 ${body.context.route}）` : '',
                body.context?.articleSlug ? `（文章 ${body.context.articleSlug}）` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
          ],
        },
        provider,
      );
    } catch (e) {
      throw llmError(e);
    }

    void rememberTopic(req.user?.id, body.message, 'chat');

    res.json({
      reply: result.text,
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
    const system =
      mode === 'fast'
        ? buildHoverSystem(style, ctx.memoryBlock)
        : buildDeepSystem(style, ctx.memoryBlock);

    initSse(res);
    sseWrite(res, {
      type: 'meta',
      model: provider.model,
      format: provider.format,
      providerId: provider.id,
      mode,
      style,
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
            {
              role: 'user',
              content: [
                body.message,
                body.context?.route ? `（当前路由 ${body.context.route}）` : '',
                body.context?.articleSlug ? `（文章 ${body.context.articleSlug}）` : '',
              ]
                .filter(Boolean)
                .join('\n'),
            },
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
        if (visible.answer) sseWrite(res, { type: 'delta', text: visible.answer });
        sseWrite(res, { type: 'final', answer: visible.answer, thinking: '' });
      } else {
        sseWrite(res, {
          type: 'final',
          answer: visible.answer,
          thinking: visible.thinking,
        });
      }
      sseWrite(res, { type: 'done' });
      void rememberTopic(req.user?.id, body.message, 'chat');
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
