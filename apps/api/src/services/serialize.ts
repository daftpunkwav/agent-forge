import { randomBytes } from 'node:crypto';
import type { Annotation, Article, AnimationDef, User, Topic } from '@prisma/client';
import type {
  PublicUser,
  ArticleSummary,
  ArticleDetail,
  AnimationDef as AnimDTO,
  TopicSummary,
  AnnotationItem,
  AuthorTier,
  UserRole,
} from '@agentforge/shared';

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as UserRole,
    authorTier: (u.authorTier as AuthorTier) || 'none',
    adminLevel: u.adminLevel ?? 0,
    bio: u.bio || undefined,
    avatarUrl: u.avatarUrl || undefined,
    headline: u.headline || undefined,
    website: u.website || undefined,
    createdAt: u.createdAt.toISOString(),
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function toAnimationDef(a: AnimationDef): AnimDTO {
  let steps: AnimDTO['steps'] = [];
  let config: Record<string, unknown> = {};
  try {
    steps = JSON.parse(a.steps);
  } catch {
    steps = [];
  }
  try {
    config = JSON.parse(a.config);
  } catch {
    config = {};
  }
  return {
    id: a.id,
    name: a.name,
    template: a.template,
    steps,
    config,
  };
}

export function toArticleSummary(
  a: Article & {
    author?: Pick<User, 'id' | 'name'>;
    domain?: { id: string; slug: string; name: string } | null;
  },
): ArticleSummary {
  return {
    id: a.id,
    slug: a.slug,
    title: a.title,
    summary: a.summary,
    category: a.category,
    level: a.level,
    status: a.status as ArticleSummary['status'],
    tags: parseJsonArray(a.tags),
    readMinutes: a.readMinutes,
    publishedAt: a.publishedAt?.toISOString() ?? null,
    viewCount: a.viewCount,
    author: a.author ? { id: a.author.id, name: a.author.name } : undefined,
    domainId: a.domainId || undefined,
    domain: a.domain
      ? { id: a.domain.id, slug: a.domain.slug, name: a.domain.name }
      : undefined,
  };
}

export function toArticleDetail(
  a: Article & {
    author?: Pick<User, 'id' | 'name'>;
    domain?: { id: string; slug: string; name: string } | null;
    animations?: { animation: AnimationDef }[];
  },
): ArticleDetail {
  return {
    ...toArticleSummary(a),
    markdown: a.markdown,
    animations: a.animations?.map((x) => toAnimationDef(x.animation)),
  };
}

export function toTopicSummary(
  t: Topic & {
    author: Pick<User, 'id' | 'name'>;
    article?: { id: string; slug: string; title: string } | null;
    _count?: { replies: number };
  },
  /** 列表场景只回摘要，避免整篇 8000 字正文随列表下发 */
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
    author: { id: t.author.id, name: t.author.name },
    replyCount: t._count?.replies ?? 0,
    createdAt: t.createdAt.toISOString(),
  };
}

export function toAnnotationItem(
  a: Annotation & { user?: Pick<User, 'id' | 'name'> },
): AnnotationItem {
  return {
    id: a.id,
    articleId: a.articleId,
    userId: a.userId,
    user: a.user ? { id: a.user.id, name: a.user.name } : undefined,
    anchorText: a.anchorText,
    sectionId: a.sectionId || undefined,
    body: a.body,
    status: a.status as AnnotationItem['status'],
    reviewBy: (a.reviewBy as AnnotationItem['reviewBy']) ?? null,
    reviewedAt: a.reviewedAt?.toISOString() ?? null,
    agentNote: a.agentNote || undefined,
    createdAt: a.createdAt.toISOString(),
  };
}

export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  // 兜底用随机短串而非时间戳：同一毫秒两次保存也会生成不同 slug
  return base || `article-${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
}
