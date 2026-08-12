/**
 * content 域文章查询(供宿主实现 agent/community 的 ArticleQueryPort)。
 * 边界：仅访问 content 归属表(Article/Domain/AnimationDef/ArticleAnimation/Annotation)。
 * 契约类型收敛于 @core/contracts,此处直接实现,不重复声明接口。
 * 未来微服务化时,宿主可用 HTTP 客户端替换,content 内部零改动。
 */
import type { PrismaClient } from '@prisma/client';
import type { ArticleQueryPort } from '@core/contracts';

export type { ArticleQueryPort };

export function createContentRepository(prisma: PrismaClient): ArticleQueryPort {
  return {
    async getArticleBySlug(slug) {
      const a = await prisma.article.findFirst({
        where: { slug, status: 'published' },
        select: {
          id: true,
          slug: true,
          title: true,
          summary: true,
          markdown: true,
          category: true,
          level: true,
        },
      });
      return a ?? null;
    },

    async getArticleMetaBySlug(slug) {
      const a = await prisma.article.findFirst({
        where: { slug },
        select: { id: true, slug: true, title: true },
      });
      return a ?? null;
    },

    async getArticlesByIds(ids) {
      const uniq = [...new Set(ids.filter(Boolean))];
      if (!uniq.length) return [];
      const rows = await prisma.article.findMany({
        where: { id: { in: uniq } },
        select: { id: true, title: true, slug: true },
      });
      return rows;
    },

    async getArticleIdBySlug(slug) {
      const a = await prisma.article.findFirst({ where: { slug }, select: { id: true } });
      return a?.id ?? null;
    },

    async searchArticles(q, take) {
      const items = await prisma.article.findMany({
        where: {
          status: 'published',
          OR: [
            { title: { contains: q } },
            { summary: { contains: q } },
            { slug: { contains: q } },
          ],
        },
        select: { title: true, slug: true, summary: true, category: true, level: true },
        orderBy: { publishedAt: 'desc' },
        take,
      });
      return items;
    },
  };
}
