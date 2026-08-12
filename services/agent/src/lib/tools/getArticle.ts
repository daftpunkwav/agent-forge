import { z } from 'zod';
import type { ToolDefinition } from './types.js';
import type { ArticleQueryPort } from '../../ports.js';

/** 正文截断上限，避免 observation 撑爆上下文 */
export const GET_ARTICLE_MAX_CHARS = 4000;

export const getArticleSchema = z.object({
  slug: z.string().min(1).max(120),
});

/** 工厂：注入文章查询端口(由宿主组合根提供 content 实现) */
export function createGetArticleTool(articles: ArticleQueryPort): ToolDefinition {
  return {
    name: 'get_article',
    description: '按 slug 获取已发布文章 Markdown（截断）',
    schema: getArticleSchema,
    async execute(args) {
      const { slug } = args as z.infer<typeof getArticleSchema>;
      const article = await articles.getArticleBySlug(slug.trim());
      if (!article) {
        return JSON.stringify({ error: '文章不存在或未发布', slug });
      }
      const md = article.markdown || '';
      const truncated = md.length > GET_ARTICLE_MAX_CHARS;
      return JSON.stringify({
        title: article.title,
        slug: article.slug,
        summary: article.summary,
        category: article.category,
        level: article.level,
        markdown: truncated ? md.slice(0, GET_ARTICLE_MAX_CHARS) : md,
        truncated,
        totalChars: md.length,
      });
    },
  };
}
