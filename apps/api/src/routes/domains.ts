import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { validate } from '../middleware/validate.js';
import { optionalAuth, requireAuth, requireRole } from '../middleware/auth.js';
import { badRequest, notFound } from '../lib/errors.js';
import { param } from '../lib/params.js';
import { toArticleSummary } from '../services/serialize.js';

const createSchema = z.object({
  name: z.string().min(1).max(80),
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/i, 'slug 仅字母数字与连字符'),
  description: z.string().max(2000).optional(),
  track: z.enum(['agent', 'llm']),
  sortOrder: z.number().int().optional(),
  color: z.string().max(40).optional(),
  published: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

export const domainsRouter = Router();

function mapDomain(d: {
  id: string;
  slug: string;
  name: string;
  description: string;
  track: string;
  sortOrder: number;
  color: string;
  published: boolean;
  _count?: { articles: number };
}) {
  return {
    id: d.id,
    slug: d.slug,
    name: d.name,
    description: d.description,
    track: d.track,
    sortOrder: d.sortOrder,
    color: d.color,
    published: d.published,
    articleCount: d._count?.articles ?? 0,
  };
}

/** 列表：按 track 可选；读者只看 published */
domainsRouter.get('/', optionalAuth, async (req, res, next) => {
  try {
    const track = req.query.track as string | undefined;
    const all = req.query.all === '1' && req.user?.role === 'admin';
    const where: Record<string, unknown> = {};
    if (track === 'agent' || track === 'llm') where.track = track;
    if (!all) where.published = true;

    const items = await prisma.domain.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: {
            articles: { where: { status: 'published' } },
          },
        },
      },
    });
    res.json({ items: items.map(mapDomain) });
  } catch (e) {
    next(e);
  }
});

/** 领域详情 + 文章分页（默认 pageSize=8） */
domainsRouter.get('/:slug', optionalAuth, async (req, res, next) => {
  try {
    const slug = param(req, 'slug');
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = Math.min(24, Math.max(1, parseInt(String(req.query.pageSize || '8'), 10) || 8));
    const q = String(req.query.q || '').trim();
    const level = String(req.query.level || '').trim();
    const sort = String(req.query.sort || 'newest');

    const domain = await prisma.domain.findUnique({ where: { slug } });
    if (!domain || (!domain.published && req.user?.role !== 'admin')) {
      throw notFound('领域不存在');
    }

    const where: Record<string, unknown> = {
      domainId: domain.id,
      status: 'published',
    };
    if (level) where.level = level;
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { summary: { contains: q } },
        { tags: { contains: q } },
      ];
    }

    const orderBy =
      sort === 'popular'
        ? { viewCount: 'desc' as const }
        : sort === 'title'
          ? { title: 'asc' as const }
          : { publishedAt: 'desc' as const };

    const [total, rows] = await Promise.all([
      prisma.article.count({ where }),
      prisma.article.findMany({
        where,
        include: { author: { select: { id: true, name: true } } },
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    res.json({
      domain: mapDomain({ ...domain, _count: { articles: total } }),
      items: rows.map(toArticleSummary),
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    next(e);
  }
});

domainsRouter.post(
  '/',
  requireAuth,
  requireRole('admin'),
  validate(createSchema),
  async (req, res, next) => {
    try {
      const body = req.body as z.infer<typeof createSchema>;
      const exists = await prisma.domain.findUnique({ where: { slug: body.slug } });
      if (exists) throw badRequest('slug 已存在');
      const d = await prisma.domain.create({
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description || '',
          track: body.track,
          sortOrder: body.sortOrder ?? 0,
          color: body.color || 'var(--chart-1)',
          published: body.published ?? true,
          createdById: req.user!.id,
        },
        include: { _count: { select: { articles: true } } },
      });
      res.status(201).json({ domain: mapDomain(d) });
    } catch (e) {
      next(e);
    }
  },
);

domainsRouter.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validate(updateSchema),
  async (req, res, next) => {
    try {
      const id = param(req, 'id');
      const existing = await prisma.domain.findUnique({ where: { id } });
      if (!existing) throw notFound('领域不存在');
      const body = req.body as z.infer<typeof updateSchema>;
      if (body.slug && body.slug !== existing.slug) {
        const clash = await prisma.domain.findUnique({ where: { slug: body.slug } });
        if (clash) throw badRequest('slug 已存在');
      }
      const d = await prisma.domain.update({
        where: { id },
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description,
          track: body.track,
          sortOrder: body.sortOrder,
          color: body.color,
          published: body.published,
        },
        include: { _count: { select: { articles: true } } },
      });
      res.json({ domain: mapDomain(d) });
    } catch (e) {
      next(e);
    }
  },
);

domainsRouter.delete('/:id', requireAuth, requireRole('admin'), async (req, res, next) => {
  try {
    const id = param(req, 'id');
    const existing = await prisma.domain.findUnique({ where: { id } });
    if (!existing) throw notFound('领域不存在');
    await prisma.article.updateMany({ where: { domainId: id }, data: { domainId: null } });
    await prisma.domain.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
