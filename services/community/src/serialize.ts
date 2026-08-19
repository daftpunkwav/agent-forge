/** community 域 DTO 序列化：话题(绑定 @core/contracts 的 TopicSummary 契约) */
import type { Topic } from '@prisma/client';
import type { TopicSummary } from '@core/contracts';
import type { UserSummary } from '@core/contracts';

/** 序列化话题(独立于 Prisma join,字段与 TopicSummary 契约绑定,防静默漂移) */
export function toTopicSummary(
  t: {
    id: string;
    title: string;
    body: string;
    kind: string;
    status: string;
    articleId: string | null;
    createdAt: Date;
    author: UserSummary;
    article: { id: string; slug: string; title: string } | null;
    replyCount?: number;
  },
  opts?: { bodyMax?: number },
): TopicSummary {
  const body = opts?.bodyMax ? t.body.slice(0, opts.bodyMax) : t.body;
  return {
    id: t.id,
    title: t.title,
    body,
    kind: t.kind as TopicSummary['kind'],
    status: t.status,
    articleId: t.articleId,
    article: t.article ?? null,
    author: t.author,
    replyCount: t.replyCount ?? 0,
    createdAt: t.createdAt.toISOString(),
  };
}

/** 批量补作者与关联文章(跨服务边界:不 join user/article 表,经注入端口取) */
export async function attachTopicRefs(
  rows: Topic[],
  deps: { users: Pick<import('@core/contracts').UserSummaryPort, 'getUserSummaries'>; articles: Pick<import('@core/contracts').ArticleQueryPort, 'getArticlesByIds'> },
): Promise<TopicSummary[]> {
  const [authors, articles] = await Promise.all([
    deps.users.getUserSummaries(rows.map((r) => r.authorId)),
    deps.articles.getArticlesByIds(rows.map((r) => r.articleId).filter(Boolean) as string[]),
  ]);
  const authorName = new Map(authors.map((a) => [a.id, a.name]));
  const articleMeta = new Map(articles.map((a) => [a.id, a]));
  return rows.map((r) =>
    toTopicSummary({
      id: r.id,
      title: r.title,
      body: r.body,
      kind: r.kind,
      status: r.status,
      articleId: r.articleId,
      createdAt: r.createdAt,
      author: { id: r.authorId, name: authorName.get(r.authorId) || '未知' },
      article: r.articleId && articleMeta.has(r.articleId) ? articleMeta.get(r.articleId)! : null,
    }),
  );
}
