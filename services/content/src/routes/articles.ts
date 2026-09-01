import { Router } from 'express';
import { z } from 'zod';
import {
  validate,
  optionalAuth,
  requireAuth,
  requireRole,
  badRequest,
  conflict,
  forbidden,
  notFound,
  param,
  attachUserRefs,
  logger,
} from '@core/foundation';
import type { Article } from '@prisma/client';
import { toArticleDetail, toArticleSummary } from '../services/serialize.js';
import { slugify } from '../domain/slug.js';
import type { UserSummaryPort } from '@core/contracts';
import { getDefaultViewDedup } from '../services/viewTracking.js';
import { createArticleRepository } from '../services/articleRepository.js';
import type { PrismaClient } from '@prisma/client';

const createSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().max(2000).optional(),
  markdown: z.string().optional(),
  category: z.string().min(1),
  level: z.string().optional(),
  tags: z.array(z.string()).optional(),
  readMinutes: z.number().int().min(1).max(120).optional(),
  slug: z.string().min(1).max(120).optional(),
  animationIds: z.array(z.string()).optional(),
  domainId: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial().extend({
  status: z.enum(['draft', 'published']).optional(),
});

const attachAuthors = (rows: Article[], users: UserSummaryPort) =>
  attachUserRefs(rows, users, (r) => r.authorId, (r, author) => ({ ...toArticleSummary(r), author }));

const fetchAuthor = (users: UserSummaryPort, authorId: string) =>
  attachUserRefs([{ authorId }], users, (r) => r.authorId, (_r, author) => author).then((a) => a[0]);

export function createArticlesRouter(prisma: PrismaClient, users: UserSummaryPort): Router {
  const articlesRouter = Router();
  const articles = createArticleRepository(prisma);
  const viewDedup = getDefaultViewDedup();

  articlesRouter.get('/', optionalAuth, async (req, res, next) => {
    try {
      const mine = req.query.mine === '1' || req.query.mine === 'true';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(48, Math.max(1, parseInt(String(req.query.pageSize || '24'), 10) || 24));

      if (mine) {
        if (!req.user) {
          res.json({ items: [], total: 0, page: 1, pageSize, totalPages: 1 });
          return;
        }
        const rows = await articles.listMine(req.user.id);
        const items = await attachAuthors(rows, users);
        res.json({
          items,
          total: items.length,
          page: 1,
          pageSize: items.length || 1,
          totalPages: 1,
        });
        return;
      }

      const excludeIds = String(req.query.exclude || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const { total, rows } = await articles.list({
        status: (req.query.status as string) || 'published',
        category: req.query.category as string | undefined,
        domainId: req.query.domainId as string | undefined,
        domainSlug: req.query.domain as string | undefined,
        level: req.query.level as string | undefined,
        q: String(req.query.q || '').trim(),
        sort: String(req.query.sort || 'latest'),
        excludeIds,
        page,
        pageSize,
        userId: req.user?.id,
        userRole: req.user?.role,
      });

      const items = await attachAuthors(rows, users);
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

  articlesRouter.get('/:slug', optionalAuth, async (req, res, next) => {
    try {
      const article = await articles.findBySlug(param(req, 'slug'));
      if (!article) throw notFound('文章不存在');
      if (article.status !== 'published') {
        const can =
          req.user &&
          (req.user.id === article.authorId || req.user.role === 'admin');
        if (!can) throw notFound('文章不存在');
      } else {
        const viewerKey = `${req.user?.id || req.ip || 'anon'}:${article.id}`;
        if (viewDedup.shouldCount(viewerKey)) {
          void articles
            .incrementViewCount(article.id)
            .catch((e) => {
              logger.warn({ err: String(e), articleId: article.id }, 'article viewCount increment failed');
            });
        }
      }
      res.json({
        article: toArticleDetail({
          ...article,
          author: await fetchAuthor(users, article.authorId),
        }),
      });
    } catch (e) {
      next(e);
    }
  });

  articlesRouter.post(
    '/',
    requireAuth,
    requireRole('author', 'admin'),
    validate(createSchema),
    async (req, res, next) => {
      try {
        const body = req.body as z.infer<typeof createSchema>;
        const article = await articles.create({
          ...body,
          authorId: req.user!.id,
        });
        res.status(201).json({
          article: toArticleDetail({
            ...article,
            author: await fetchAuthor(users, article.authorId),
          }),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  articlesRouter.patch(
    '/:id',
    requireAuth,
    requireRole('author', 'admin'),
    validate(updateSchema),
    async (req, res, next) => {
      try {
        const existing = await articles.findById(param(req, 'id'));
        if (!existing) throw notFound('文章不存在');
        if (existing.authorId !== req.user!.id && req.user!.role !== 'admin') {
          throw forbidden();
        }
        const body = req.body as z.infer<typeof updateSchema>;
        let slug = body.slug;
        if (slug !== undefined) {
          slug = slugify(slug);
          if (slug !== existing.slug) {
            const clash = await articles.findBySlugOnly(slug);
            if (clash) throw conflict('slug 已被其他文章占用');
          }
        }

        const article = await articles.update(existing.id, {
          title: body.title,
          summary: body.summary,
          markdown: body.markdown,
          category: body.category,
          level: body.level,
          tags: body.tags,
          readMinutes: body.readMinutes,
          slug,
          domainId: body.domainId,
          status: body.status,
          animationIds: body.animationIds,
          wasPublished: existing.status === 'published',
          publishedAt: existing.publishedAt,
        });
        res.json({
          article: toArticleDetail({
            ...article,
            author: await fetchAuthor(users, article.authorId),
          }),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  articlesRouter.post(
    '/:id/publish',
    requireAuth,
    requireRole('author', 'admin'),
    async (req, res, next) => {
      try {
        const existing = await articles.findById(param(req, 'id'));
        if (!existing) throw notFound('文章不存在');
        if (existing.authorId !== req.user!.id && req.user!.role !== 'admin') {
          throw forbidden();
        }
        if (!existing.title.trim() || !existing.markdown.trim()) {
          throw badRequest('发布前请填写标题与正文');
        }
        const article = await articles.publish(existing.id, existing.publishedAt);
        res.json({
          article: toArticleDetail({
            ...article,
            author: await fetchAuthor(users, article.authorId),
          }),
        });
      } catch (e) {
        next(e);
      }
    },
  );

  return articlesRouter;
}
