import { Router } from 'express';
import { z } from 'zod';
import { validate, optionalAuth, requireAuth, requirePermission, forbidden, notFound, param } from '@core/foundation';
import type { PrismaClient } from '@prisma/client';
import type { ArticleQueryPort } from '@core/contracts';
import type { UserSummaryPort as UserQueryPort } from '@core/contracts';
import { attachTopicRefs, toTopicSummary } from '../serialize.js';
import { resolveLinkedArticleId } from '../articleLink.js';

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

export function createTopicsRouter(
  prisma: PrismaClient,
  deps: { users: UserQueryPort; articles: ArticleQueryPort },
): Router {
  const topicsRouter = Router();

  topicsRouter.get('/', optionalAuth, async (req, res, next) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(40, Math.max(1, parseInt(String(req.query.pageSize || '20'), 10) || 20));
      const articleId = req.query.articleId as string | undefined;
      const where: Record<string, unknown> = { status: { not: 'deleted' } };
      if (articleId) where.articleId = articleId;

      const [total, rows] = await Promise.all([
        prisma.topic.count({ where }),
        prisma.topic.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      // 列表只回 160 字摘要，详情接口回全文（见 GET /:id）
      const items = (await attachTopicRefs(rows, deps)).map((t) => ({
        ...t,
        body: t.body.slice(0, 160),
      }));
      res.json({
        items,
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
          _count: { select: { replies: true } },
          replies: {
            orderBy: { createdAt: 'asc' },
            take: 100,
          },
        },
      });
      if (!topic || topic.status === 'deleted') throw notFound('话题不存在');
      const [authors, replyAuthors] = await Promise.all([
        deps.users.getUserSummaries([topic.authorId]),
        deps.users.getUserSummaries(topic.replies.map((r) => r.authorId)),
      ]);
      const aMap = new Map(authors.map((a) => [a.id, a.name]));
      const rMap = new Map(replyAuthors.map((a) => [a.id, a.name]));
      const [articleMeta] = topic.articleId
        ? await deps.articles.getArticlesByIds([topic.articleId]).then((a) => [a[0] ?? null])
        : [null];
      res.json({
        topic: toTopicSummary({
          id: topic.id,
          title: topic.title,
          body: topic.body,
          kind: topic.kind,
          status: topic.status,
          articleId: topic.articleId,
          createdAt: topic.createdAt,
          author: { id: topic.authorId, name: aMap.get(topic.authorId) || '未知' },
          article: articleMeta,
          replyCount: topic._count.replies,
        }),
        replies: topic.replies.map((r) => ({
          id: r.id,
          body: r.body,
          createdAt: r.createdAt.toISOString(),
          author: { id: r.authorId, name: rMap.get(r.authorId) || '未知' },
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
        const articleId = await resolveLinkedArticleId(deps.articles, {
          articleId: body.articleId,
          articleSlug: body.articleSlug,
        });
        const topic = await prisma.topic.create({
          data: {
            title: body.title,
            body: body.body,
            kind: body.kind || 'discussion',
            authorId: req.user!.id,
            articleId,
          },
        });
        const [created] = await attachTopicRefs([topic], deps);
        res.status(201).json({ topic: created });
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
        });
        const authors = await deps.users.getUserSummaries([reply.authorId]);
        res.status(201).json({
          reply: {
            id: reply.id,
            body: reply.body,
            createdAt: reply.createdAt.toISOString(),
            author: { id: reply.authorId, name: authors[0]?.name || '未知' },
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

  return topicsRouter;
}
