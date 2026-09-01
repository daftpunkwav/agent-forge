/**
 * 话题关联文章：一律经 ArticleQueryPort 校验，禁止裸 articleId 写入。
 */
import { badRequest } from '@core/foundation';
import type { ArticleQueryPort } from '@core/contracts';

export async function resolveLinkedArticleId(
  articles: Pick<ArticleQueryPort, 'getArticleIdBySlug' | 'getArticlesByIds'>,
  input: { articleId?: string | null; articleSlug?: string },
): Promise<string | null> {
  if (input.articleId) {
    const found = await articles.getArticlesByIds([input.articleId]);
    if (!found.length) throw badRequest('关联文章不存在');
    return found[0].id;
  }
  if (input.articleSlug) {
    const id = await articles.getArticleIdBySlug(input.articleSlug);
    if (!id) throw badRequest('关联文章不存在');
    return id;
  }
  return null;
}
