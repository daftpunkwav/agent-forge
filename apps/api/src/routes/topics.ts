import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth, requirePermission } from '../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { toTopicSummary } from '../services/serialize.js';
import { param } from '../lib/params.js';

const createSchema = z.object({
  title: z.string().min(2).max(200),
  body: z.string().min(1).max(8000),
  kind: z.enum(['discussion', 'question', 'opinion']).optional(),
  articleId: z.string().optional().nullable(),
  articleSlug: z.string().optional(),
});

const replySchema = z.object({
  body: z.string().min(1).max(4000),
});

export const topicsRouter = Router();

topicsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(40, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
    const articleId = req.query.articleId as string | undefined;
    const where: Record<string, unknown> = { status: { not: 'deleted' } };
    if (articleId) where.articleId = articleId;

    const [total, items] = await Promise.all([
      prisma.topic.count({ where }),
      prisma.topic.findMany({
        where,
        include: {
          author: { select: { id: true, name: true } },
          article: { select: { id: true, slug: true, title: true } },
          _count: { select: { replies: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    res.json({
      items: items.map(toTopicSummary),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    next(e);
  }
});

topicsRouter.get('/:id', optionalAuth, async (req, res, next) => {
  try {
    const id = param(req, 'id');
    const topic = await prisma.topic.findUnique({
      where: { id },
      include: {
        author: { select: { id: true, name: true } },
        article: { select: { id: true, slug: true, title: true } },
        _count: { select: { replies: true } },
        replies: {
          include: { author: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'asc' },
          take: 100,
        },
      },
    });
    if (!topic || topic.status === 'deleted') throw notFound('话题不存在');
    res.json({
      topic: toTopicSummary(topic),
      replies: topic.replies.map((r) => ({
        id: r.id,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        author: r.author,
      })),
    });
  } catch (e) {
    next(e);
  }
});

topicsRouter.post(
  '/',
  requireAuth,
  requirePermission('topic.post'),
  validate(createSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;
      let articleId = body.articleId || null;
      if (!articleId && body.articleSlug) {
        const art = await prisma.article.findUnique({ where: { slug: body.articleSlug } });
        if (!art) throw badRequest('关联文章不存在');
        articleId = art.id;
      }
      const topic = await prisma.topic.create({
        data: {
          title: body.title,
          body: body.body,
          kind: body.kind || 'discussion',
          authorId: req.user!.id,
          articleId,
        },
        include: {
          author: { select: { id: true, name: true } },
          article: { select: { id: true, slug: true, title: true } },
          _count: { select: { replies: true } },
        },
      });
      res.status(201).json({ topic: toTopicSummary(topic) });
    } catch (e) {
      next(e);
    }
  },
);

topicsRouter.post(
  '/:id/replies',
  requireAuth,
  requirePermission('topic.post'),
  validate(replySchema),
  async (req, res, next) => {
    try {
      const id = param(req, 'id');
      const topic = await prisma.topic.findUnique({ where: { id } });
      if (!topic || topic.status === 'deleted') throw notFound('话题不存在');
      const body = req.body as z.infer<typeof replySchema>;
      const reply = await prisma.topicReply.create({
        data: {
          topicId: id,
          authorId: req.user!.id,
          body: body.body,
        },
        include: { author: { select: { id: true, name: true } } },
      });
      res.status(201).json({
        reply: {
          id: reply.id,
          body: reply.body,
          createdAt: reply.createdAt.toISOString(),
          author: reply.author,
        },
      });
    } catch (e) {
      next(e);
    }
  },
);

topicsRouter.delete('/:id', requireAuth, async (req, res, next) => {
  try {
    const id = param(req, 'id');
    const topic = await prisma.topic.findUnique({ where: { id } });
    if (!topic) throw notFound();
    const isOwner = topic.authorId === req.user!.id;
    const isAdmin = req.user!.role === 'admin';
    if (!isOwner && !isAdmin) throw forbidden();
    await prisma.topic.update({ where: { id }, data: { status: 'deleted' } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
