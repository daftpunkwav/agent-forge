import { Router } from 'express';
import { z } from 'zod';
import { validate, optionalAuth, requireAuth, requireRole, badRequest, conflict, forbidden, notFound, param } from '@core/foundation';
import type { PrismaClient, Article } from '@prisma/client';
import { slugify, toArticleDetail, toArticleSummary } from '../services/serialize.js';
import type { UserQueryPort } from '../ports.js';

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

/** 批量补作者名(跨服务边界：不 join user 表,经用户端口批量取) */
async function attachAuthors(rows: Article[], users: UserQueryPort) {
  const authors = await users.getUserSummaries(rows.map((r) => r.authorId));
  const byId = new Map(authors.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    ...toArticleSummary(r),
    author: byId.has(r.authorId) ? { id: r.authorId, name: byId.get(r.authorId)! } : undefined,
  }));
}

/** 单条作者名(详情/创建/更新响应用) */
async function fetchAuthor(users: UserQueryPort, authorId: string) {
  const authors = await users.getUserSummaries([authorId]);
  return authors[0] ? { id: authors[0].id, name: authors[0].name } : undefined;
}

export function createArticlesRouter(prisma: PrismaClient, users: UserQueryPort): Router {
  const articlesRouter = Router();

  /**
   * 阅读量去重（进程内存级）：同一用户/IP 24h 内对同一篇文章只计一次。
   * 多实例部署下每实例各自计数，仍能显著抑制刷新/爬虫刷量；生产可换 Redis。
   */
  const VIEW_DEDUP_TTL_MS = 24 * 60 * 60 * 1000;
  const viewedCache = new Map<string, number>();

  function shouldCountView(key: string): boolean {
    const now = Date.now();
    const last = viewedCache.get(key);
    if (last && now - last < VIEW_DEDUP_TTL_MS) return false;
    viewedCache.set(key, now);
    // 防内存膨胀：量级超过阈值时顺带清理过期键
    if (viewedCache.size > 10_000) {
      for (const [k, v] of viewedCache) {
        if (now - v > VIEW_DEDUP_TTL_MS) viewedCache.delete(k);
      }
    }
    return true;
  }

  articlesRouter.get('/', optionalAuth, async (req, res, next) => {
    try {
      const status = (req.query.status as string) || 'published';
      const category = req.query.category as string | undefined;
      const domainId = req.query.domainId as string | undefined;
      const domainSlug = req.query.domain as string | undefined;
      const level = req.query.level as string | undefined;
      const q = String(req.query.q || '').trim();
      const mine = req.query.mine === '1' || req.query.mine === 'true';
      const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
      const pageSize = Math.min(48, Math.max(1, parseInt(String(req.query.pageSize || '24'), 10) || 24));

      if (mine) {
        if (!req.user) {
          res.json({ items: [], total: 0, page: 1, pageSize, totalPages: 1 });
          return;
        }
        const rows = await prisma.article.findMany({
          where: { authorId: req.user.id },
          include: { domain: true },
          orderBy: { updatedAt: 'desc' },
        });
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

      const where: Record<string, unknown> = {};
      if (status === 'published') {
        where.status = 'published';
      } else if (status === 'all' && req.user?.role === 'admin') {
        // admin 可看全部
      } else if (status === 'draft' && req.user) {
        where.status = 'draft';
        where.authorId = req.user.id;
      } else {
        where.status = 'published';
      }
      if (category) where.category = category;
      if (level) where.level = level;
      if (domainId) where.domainId = domainId;
      if (domainSlug) {
        const d = await prisma.domain.findUnique({ where: { slug: domainSlug } });
        if (d) where.domainId = d.id;
      }
      if (q) {
        where.OR = [
          { title: { contains: q } },
          { summary: { contains: q } },
          { tags: { contains: q } },
        ];
      }

      const sort = String(req.query.sort || 'latest');
      const excludeIds = String(req.query.exclude || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (excludeIds.length) {
        where.id = { notIn: excludeIds };
      }

      const orderBy =
        sort === 'popular'
          ? ([{ viewCount: 'desc' as const }, { publishedAt: 'desc' as const }] as const)
          : ([{ publishedAt: 'desc' as const }, { updatedAt: 'desc' as const }] as const);

      const [total, rows] = await Promise.all([
        prisma.article.count({ where }),
        prisma.article.findMany({
          where,
          include: { domain: true },
          orderBy: [...orderBy],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
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
      const article = await prisma.article.findUnique({
        where: { slug: param(req, 'slug') },
        include: {
          domain: { select: { id: true, slug: true, name: true } },
          animations: {
            orderBy: { sortOrder: 'asc' },
            include: { animation: true },
          },
        },
      });
      if (!article) throw notFound('文章不存在');
      if (article.status !== 'published') {
        const can =
          req.user &&
          (req.user.id === article.authorId || req.user.role === 'admin');
        if (!can) throw notFound('文章不存在');
      } else {
        // 异步增加阅读量（24h 内同一用户/IP 去重，防刷新刷量）
        const viewerKey = `${req.user?.id || req.ip || 'anon'}:${article.id}`;
        if (shouldCountView(viewerKey)) {
          void prisma.article
            .update({
              where: { id: article.id },
              data: { viewCount: { increment: 1 } },
            })
            .catch(() => undefined);
        }
      }
      // 作者名经用户端口补
      res.json({ article: toArticleDetail({ ...article, author: await fetchAuthor(users, article.authorId) }) });
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
        let slug = body.slug || slugify(body.title);
        const exists = await prisma.article.findUnique({ where: { slug } });
        if (exists) slug = `${slug}-${Date.now().toString(36)}`;

        const article = await prisma.article.create({
          data: {
            title: body.title,
            slug,
            summary: body.summary || '',
            markdown: body.markdown || '',
            category: body.category,
            level: body.level || '入门',
            tags: JSON.stringify(body.tags || []),
            readMinutes: body.readMinutes || 8,
            authorId: req.user!.id,
            domainId: body.domainId || null,
            status: 'draft',
            animations: body.animationIds?.length
              ? {
                  create: body.animationIds.map((animationId, i) => ({
                    animationId,
                    sortOrder: i,
                  })),
                }
              : undefined,
          },
          include: {
            animations: { include: { animation: true } },
          },
        });
        res.status(201).json({ article: toArticleDetail({ ...article, author: await fetchAuthor(users, article.authorId) }) });
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
        const existing = await prisma.article.findUnique({ where: { id: param(req, 'id') } });
        if (!existing) throw notFound('文章不存在');
        if (existing.authorId !== req.user!.id && req.user!.role !== 'admin') {
          throw forbidden();
        }
        const body = req.body as z.infer<typeof updateSchema>;
        const data: Record<string, unknown> = {};
        if (body.title !== undefined) data.title = body.title;
        if (body.summary !== undefined) data.summary = body.summary;
        if (body.markdown !== undefined) data.markdown = body.markdown;
        if (body.category !== undefined) data.category = body.category;
        if (body.level !== undefined) data.level = body.level;
        if (body.tags !== undefined) data.tags = JSON.stringify(body.tags);
        if (body.readMinutes !== undefined) data.readMinutes = body.readMinutes;
        if (body.slug !== undefined) {
          // 与 POST 一致先 slugify 归一化；归一化后被其他文章占用则 409 冲突
          const slug = slugify(body.slug);
          if (slug !== existing.slug) {
            const clash = await prisma.article.findUnique({ where: { slug } });
            if (clash) throw conflict('slug 已被其他文章占用');
          }
          data.slug = slug;
        }
        if (body.domainId !== undefined) data.domainId = body.domainId;
        if (body.status === 'published' && existing.status !== 'published') {
          data.status = 'published';
          data.publishedAt = new Date();
        } else if (body.status === 'draft') {
          data.status = 'draft';
        }

        if (body.animationIds) {
          await prisma.articleAnimation.deleteMany({ where: { articleId: existing.id } });
          await prisma.articleAnimation.createMany({
            data: body.animationIds.map((animationId, i) => ({
              articleId: existing.id,
              animationId,
              sortOrder: i,
            })),
          });
        }

        const article = await prisma.article.update({
          where: { id: existing.id },
          data,
          include: {
            animations: { orderBy: { sortOrder: 'asc' }, include: { animation: true } },
          },
        });
        res.json({ article: toArticleDetail({ ...article, author: await fetchAuthor(users, article.authorId) }) });
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
        const existing = await prisma.article.findUnique({ where: { id: param(req, 'id') } });
        if (!existing) throw notFound('文章不存在');
        if (existing.authorId !== req.user!.id && req.user!.role !== 'admin') {
          throw forbidden();
        }
        if (!existing.title.trim() || !existing.markdown.trim()) {
          throw badRequest('发布前请填写标题与正文');
        }
        const article = await prisma.article.update({
          where: { id: existing.id },
          data: {
            status: 'published',
            publishedAt: existing.publishedAt || new Date(),
          },
          include: {
            animations: { include: { animation: true } },
          },
        });
        res.json({ article: toArticleDetail({ ...article, author: await fetchAuthor(users, article.authorId) }) });
      } catch (e) {
        next(e);
      }
    },
  );

  return articlesRouter;
}
