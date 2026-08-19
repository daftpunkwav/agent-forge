import type { Annotation, Article, AnimationDef } from '@prisma/client';
import type {
  ArticleSummary,
  ArticleDetail,
  AnimationDef as AnimDTO,
  AnnotationItem,
  UserSummary,
} from '@core/contracts';

/** 作者形状：跨域数据来自 UserQueryPort(不耦合 Prisma User 表结构) */
type AuthorRef = UserSummary;

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
    author?: AuthorRef;
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
    author?: AuthorRef;
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

export function toAnnotationItem(a: Annotation & { user?: AuthorRef }): AnnotationItem {
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

