/**
 * Agent 域 HTTP 路由装配：限流 + 元信息/记忆/进度 + 挂载讲解/对话子路由。
 */
import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import {
  validate,
  optionalAuth,
  requireAuth,
  requireRole,
  badRequest,
} from '@core/foundation';
import { upsertLearningProgress } from '../services/learningProgress.js';
import { AGENT_MODE_META } from '../lib/agentPrompt.js';
import { mountExplainRoutes } from './explain.js';
import { mountChatRoutes } from './chat.js';
import type { AgentRuntime } from '../runtime.js';

export function createAgentRouter(runtime: AgentRuntime): Router {
  const { prisma, users, articles, llm } = runtime.deps;

  const agentRouter = Router();

  const agentHoverLimiter = rateLimit({
    windowMs: 60_000,
    max: 90,
    message: { error: { code: 'RATE_LIMIT', message: '讲解请求过于频繁，请稍后再试' } },
  });
  const agentChatLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '对话请求过于频繁，请稍后再试' } },
  });
  const agentWriteLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '操作过于频繁，请稍后再试' } },
  });

  agentRouter.get('/meta', (_req, res) => {
    res.json({
      modes: AGENT_MODE_META,
      formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
    });
  });

  agentRouter.post('/cache/clear', agentWriteLimiter, requireAuth, requireRole('admin'), async (_req, res, next) => {
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
        const prefs = await users.getUserPreferences(req.user.id);
        byokEnabled = Boolean(prefs?.byok?.enabled);
      }
      res.json({
        providers: llm.listPublicProviders(),
        defaultId: llm.getDefaultProvider()?.id || null,
        formats: ['anthropic_messages', 'openai_chat', 'openai_responses'],
        byokEnabled,
        modes: AGENT_MODE_META,
      });
    } catch (e) {
      next(e);
    }
  });

  mountExplainRoutes(agentRouter, runtime, agentHoverLimiter);
  mountChatRoutes(agentRouter, runtime, agentChatLimiter);

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
    agentWriteLimiter,
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
    agentWriteLimiter,
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
        const article = await articles.getArticleMetaBySlug(body.articleSlug);
        if (!article) throw badRequest('文章不存在');
        const item = await upsertLearningProgress(prisma, {
          userId: req.user!.id,
          articleId: article.id,
          progress: body.progress,
          mastery: body.mastery,
        });
        if (item.mastery === 'mastered') {
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

  return agentRouter;
}
