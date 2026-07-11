import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth, requirePermission } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { toAnnotationItem } from '../services/serialize.js';
import { param } from '../lib/params.js';
import { callLlm, resolveProvider } from '../lib/llm/providers.js';
import type { ByokConfig } from '../lib/llm/types.js';

const createSchema = z.object({
  articleId: z.string().optional(),
  articleSlug: z.string().optional(),
  anchorText: z.string().max(500).optional(),
  sectionId: z.string().max(120).optional(),
  body: z.string().min(1).max(4000),
});

const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  note: z.string().max(500).optional(),
});

export const annotationsRouter = Router();

function parsePrefs(raw?: string | null): Record<string, unknown> {
  try {
    return JSON.parse(raw || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

annotationsRouter.get('/article/:slugOrId', optionalAuth, async (req, res, next) => {
  try {
    const key = param(req, 'slugOrId');
    const article = await prisma.article.findFirst({
      where: { OR: [{ id: key }, { slug: key }] },
    });
    if (!article) throw notFound('文章不存在');

    const isStaff =
      req.user?.role === 'admin' ||
      (req.user && article.authorId === req.user.id);

    const where: Record<string, unknown> = { articleId: article.id };
    if (!isStaff) {
      // 游客/读者：已通过 + 自己的全部
      if (req.user) {
        where.OR = [{ status: 'approved' }, { userId: req.user.id }];
      } else {
        where.status = 'approved';
      }
    }

    const items = await prisma.annotation.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    res.json({ items: items.map(toAnnotationItem), articleId: article.id });
  } catch (e) {
    next(e);
  }
});

annotationsRouter.post(
  '/',
  requireAuth,
  requirePermission('annotation.write'),
  validate(createSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;
      let articleId = body.articleId;
      if (!articleId && body.articleSlug) {
        const a = await prisma.article.findUnique({ where: { slug: body.articleSlug } });
        if (!a) throw badRequest('文章不存在');
        articleId = a.id;
      }
      if (!articleId) throw badRequest('需要 articleId 或 articleSlug');

      const article = await prisma.article.findUnique({
        where: { id: articleId },
        include: { author: true },
      });
      if (!article) throw notFound('文章不存在');

      let status = 'pending';
      let reviewBy: string | null = null;
      let agentNote = '';
      let reviewedAt: Date | null = null;
      let reviewerId: string | null = null;

      // 管理员批注直接通过
      if (req.user!.role === 'admin') {
        status = 'approved';
        reviewBy = 'admin';
        reviewedAt = new Date();
        reviewerId = req.user!.id;
      } else if (article.author.allowAgentAnnotationReview) {
        // 作者授权 Agent 审核
        try {
          const pref = parsePrefs(article.author.preferences);
          const byok = (pref.byok as ByokConfig) || null;
          const provider = resolveProvider(byok);
          if (provider) {
            const result = await callLlm(
              {
                mode: 'fast',
                maxTokens: 200,
                messages: [
                  {
                    role: 'system',
                    content:
                      '你是批注审核员。判断批注是否礼貌、相关、无人身攻击。只回复 JSON：{"ok":true|false,"reason":"..."}',
                  },
                  {
                    role: 'user',
                    content: `文章：${article.title}\n锚点：${body.anchorText || '（无）'}\n批注：${body.body}`,
                  },
                ],
              },
              provider,
            );
            const raw = result.text || '';
            const m = raw.match(/\{[\s\S]*\}/);
            if (m) {
              const j = JSON.parse(m[0]) as { ok?: boolean; reason?: string };
              if (j.ok) {
                status = 'approved';
                reviewBy = 'agent';
                reviewedAt = new Date();
                agentNote = j.reason || 'Agent 通过';
              } else {
                status = 'rejected';
                reviewBy = 'agent';
                reviewedAt = new Date();
                agentNote = j.reason || 'Agent 拒绝';
              }
            }
          }
        } catch {
          // Agent 失败则保持 pending 交作者
          status = 'pending';
        }
      }

      const row = await prisma.annotation.create({
        data: {
          articleId,
          userId: req.user!.id,
          anchorText: body.anchorText || '',
          sectionId: body.sectionId || '',
          body: body.body,
          status,
          reviewBy,
          reviewedAt: reviewedAt || undefined,
          reviewerId,
          agentNote,
        },
        include: { user: { select: { id: true, name: true } } },
      });
      res.status(201).json({ annotation: toAnnotationItem(row) });
    } catch (e) {
      next(e);
    }
  },
);

annotationsRouter.patch(
  '/:id/review',
  requireAuth,
  validate(reviewSchema),
  async (req, res, next) => {
    try {
      const id = param(req, 'id');
      const body = req.body as z.infer<typeof reviewSchema>;
      const ann = await prisma.annotation.findUnique({
        where: { id },
        include: { article: true },
      });
      if (!ann) throw notFound();

      const isAuthor = ann.article.authorId === req.user!.id;
      const isAdmin = req.user!.role === 'admin';
      if (!isAuthor && !isAdmin) throw forbidden('仅作者或管理员可审核');

      const updated = await prisma.annotation.update({
        where: { id },
        data: {
          status: body.status,
          reviewBy: isAdmin ? 'admin' : 'author',
          reviewedAt: new Date(),
          reviewerId: req.user!.id,
          agentNote: body.note || '',
        },
        include: { user: { select: { id: true, name: true } } },
      });
      res.json({ annotation: toAnnotationItem(updated) });
    } catch (e) {
      next(e);
    }
  },
);
