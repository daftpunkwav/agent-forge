import type { Article, AnimationDef, User } from '@prisma/client';
import type { PublicUser, ArticleSummary, ArticleDetail, AnimationDef as AnimDTO } from '@agentforge/shared';

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as PublicUser['role'],
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

export function slugify(title: string): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^\w\u4e00-\u9fff-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  return base || `article-${Date.now()}`;
}
