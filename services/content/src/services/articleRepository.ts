/**
 * 文章 CRUD 与列表查询（路由层不直接访问 prisma.article）
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { slugify } from '../domain/slug.js';

export type ArticleListQuery = {
  status?: string;
  category?: string;
  domainId?: string;
  domainSlug?: string;
  level?: string;
  q?: string;
  sort?: string;
  excludeIds?: string[];
  page: number;
  pageSize: number;
  userId?: string;
  userRole?: string;
};

export function createArticleRepository(prisma: PrismaClient) {
  return {
    async listMine(authorId: string) {
      return prisma.article.findMany({
        where: { authorId },
        include: { domain: true },
        orderBy: { updatedAt: 'desc' },
      });
    },

    async list(query: ArticleListQuery) {
      const where: Prisma.ArticleWhereInput = {};
      const status = query.status || 'published';

      if (status === 'published') {
        where.status = 'published';
      } else if (status === 'all' && query.userRole === 'admin') {
        // admin 可看全部
      } else if (status === 'draft' && query.userId) {
        where.status = 'draft';
        where.authorId = query.userId;
      } else {
        where.status = 'published';
      }

      if (query.category) where.category = query.category;
      if (query.level) where.level = query.level;
      if (query.domainId) where.domainId = query.domainId;
      if (query.domainSlug) {
        const d = await prisma.domain.findUnique({ where: { slug: query.domainSlug } });
        if (d) where.domainId = d.id;
      }
      if (query.q) {
        where.OR = [
          { title: { contains: query.q } },
          { summary: { contains: query.q } },
          { tags: { contains: query.q } },
        ];
      }
      if (query.excludeIds?.length) {
        where.id = { notIn: query.excludeIds };
      }

      const orderBy =
        query.sort === 'popular'
          ? ([{ viewCount: 'desc' as const }, { publishedAt: 'desc' as const }] as const)
          : ([{ publishedAt: 'desc' as const }, { updatedAt: 'desc' as const }] as const);

      const [total, rows] = await Promise.all([
        prisma.article.count({ where }),
        prisma.article.findMany({
          where,
          include: { domain: true },
          orderBy: [...orderBy],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);

      return { total, rows };
    },

    findBySlug(slug: string) {
      return prisma.article.findUnique({
        where: { slug },
        include: {
          domain: { select: { id: true, slug: true, name: true } },
          animations: {
            orderBy: { sortOrder: 'asc' },
            include: { animation: true },
          },
        },
      });
    },

    findById(id: string) {
      return prisma.article.findUnique({ where: { id } });
    },

    findBySlugOnly(slug: string) {
      return prisma.article.findUnique({ where: { slug } });
    },

    incrementViewCount(articleId: string) {
      return prisma.article.update({
        where: { id: articleId },
        data: { viewCount: { increment: 1 } },
      });
    },

    async create(data: {
      title: string;
      summary?: string;
      markdown?: string;
      category: string;
      level?: string;
      tags?: string[];
      readMinutes?: number;
      slug?: string;
      authorId: string;
      domainId?: string | null;
      animationIds?: string[];
    }) {
      let slug = data.slug || slugify(data.title);
      const exists = await prisma.article.findUnique({ where: { slug } });
      if (exists) slug = `${slug}-${Date.now().toString(36)}`;

      return prisma.article.create({
        data: {
          title: data.title,
          slug,
          summary: data.summary || '',
          markdown: data.markdown || '',
          category: data.category,
          level: data.level || '入门',
          tags: JSON.stringify(data.tags || []),
          readMinutes: data.readMinutes || 8,
          authorId: data.authorId,
          domainId: data.domainId || null,
          status: 'draft',
          animations: data.animationIds?.length
            ? {
                create: data.animationIds.map((animationId, i) => ({
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
    },

    async update(
      id: string,
      data: {
        title?: string;
        summary?: string;
        markdown?: string;
        category?: string;
        level?: string;
        tags?: string[];
        readMinutes?: number;
        slug?: string;
        domainId?: string | null;
        status?: 'draft' | 'published';
        animationIds?: string[];
        existingSlug?: string;
        wasPublished?: boolean;
        publishedAt?: Date | null;
      },
    ) {
      const patch: Prisma.ArticleUpdateInput = {};
      if (data.title !== undefined) patch.title = data.title;
      if (data.summary !== undefined) patch.summary = data.summary;
      if (data.markdown !== undefined) patch.markdown = data.markdown;
      if (data.category !== undefined) patch.category = data.category;
      if (data.level !== undefined) patch.level = data.level;
      if (data.tags !== undefined) patch.tags = JSON.stringify(data.tags);
      if (data.readMinutes !== undefined) patch.readMinutes = data.readMinutes;
      if (data.slug !== undefined) patch.slug = data.slug;
      if (data.domainId !== undefined) patch.domainId = data.domainId;
      if (data.status === 'published' && !data.wasPublished) {
        patch.status = 'published';
        patch.publishedAt = new Date();
      } else if (data.status === 'draft') {
        patch.status = 'draft';
      }

      if (data.animationIds) {
        await prisma.articleAnimation.deleteMany({ where: { articleId: id } });
        await prisma.articleAnimation.createMany({
          data: data.animationIds.map((animationId, i) => ({
            articleId: id,
            animationId,
            sortOrder: i,
          })),
        });
      }

      return prisma.article.update({
        where: { id },
        data: patch,
        include: {
          animations: { orderBy: { sortOrder: 'asc' }, include: { animation: true } },
        },
      });
    },

    publish(id: string, publishedAt: Date | null) {
      return prisma.article.update({
        where: { id },
        data: {
          status: 'published',
          publishedAt: publishedAt || new Date(),
        },
        include: {
          animations: { include: { animation: true } },
        },
      });
    },
  };
}

export type ArticleRepository = ReturnType<typeof createArticleRepository>;
