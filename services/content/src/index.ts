/**
 * @core/content —— 内容创作域：文章/动画/领域/批注(独立 workspace)。
 * 工厂注入 PrismaClient + UserQueryPort(作者名,不 join user 表)。
 * 默认由宿主同进程装配;未来独立进程 = 提供 HTTP 客户端实现后调用。
 */
import { Router } from 'express';
import { createArticlesRouter } from './routes/articles.js';
import { createAnimationsRouter } from './routes/animations.js';
import { createDomainsRouter } from './routes/domains.js';
import { createAnnotationsRouter } from './routes/annotations.js';
import type { UserSummaryPort } from '@core/contracts';

/** content 只消费用户摘要子集(收窄自 contracts 的 UserQueryPort) */
export type UserQueryPort = UserSummaryPort;

export interface ContentDeps {
  prisma: import('@prisma/client').PrismaClient;
  users: UserQueryPort;
}

export interface ContentRouters {
  articles: Router;
  animations: Router;
  domains: Router;
  annotations: Router;
}

export function createContentRouters(deps: ContentDeps): ContentRouters {
  return {
    articles: createArticlesRouter(deps.prisma, deps.users),
    animations: createAnimationsRouter(deps.prisma),
    domains: createDomainsRouter(deps.prisma, deps.users),
    annotations: createAnnotationsRouter(deps.prisma, deps.users),
  };
}

/** 独立装配(standalone 用):合并成单一 Router */
export function createContentRouter(deps: ContentDeps): Router {
  const { articles, animations, domains, annotations } = createContentRouters(deps);
  return Router().use(articles, animations, domains, annotations);
}

export { createContentRepository } from './repositories.js';
export type { ArticleQueryPort } from './repositories.js';
