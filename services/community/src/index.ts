/**
 * @core/community —— 话题论坛域(独立 workspace)。
 * 工厂注入 PrismaClient + users/articles 端口(作者名/关联文章,不跨服务直查)。
 */
import { Router } from 'express';
import { createTopicsRouter } from './routes/topics.js';
import type { ArticleQueryPort, UserSummaryPort } from '@core/contracts';

/** community 只消费用户摘要子集 */
export type UserQueryPort = UserSummaryPort;

export interface CommunityDeps {
  prisma: import('@prisma/client').PrismaClient;
  users: UserQueryPort;
  articles: ArticleQueryPort;
}

export function createCommunityRouters(deps: CommunityDeps): { topics: Router } {
  return { topics: createTopicsRouter(deps.prisma, { users: deps.users, articles: deps.articles }) };
}

/** 独立装配(standalone 用):合并成单一 Router */
export function createCommunityRouter(deps: CommunityDeps): Router {
  const { topics } = createCommunityRouters(deps);
  return Router().use(topics);
}

export type { ArticleQueryPort } from '@core/contracts';
