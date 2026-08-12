/**
 * 宿主组合根(composition root)——全仓唯一允许 import 所有服务的层。
 * 职责：创建共享基础设施 → 实例化各服务 repository → 实现跨服务 ports →
 *       按依赖图注入各服务 → 返回「前缀 → Router」挂载表。
 *
 * 微服务化演进：仅改本文件——把各 port 的「同进程 delegate 实现」换成
 * HTTP 客户端实现，并让各服务自行 listen；服务内部代码零改动。
 *
 * 端口契约类型收敛于 @core/contracts,因此 usersPort(identity 提供)天然满足
 * content/community 消费的 UserSummaryPort 子集,无需强制转型。
 */
import type { Router } from 'express';
import type { PrismaClient } from '@prisma/client';
import type { LlmGateway } from '@core/llm';
import type { UserQueryPort } from '@core/contracts';
import { createIdentityRouters } from '@core/identity';
import { getUserSummaries, getUserPreferences } from '@core/identity';
import { createContentRouters, createContentRepository } from '@core/content';
import { createCommunityRouters } from '@core/community';
import { createAgentRuntime, createAgentRouter } from '@core/agent';

export interface ComposeResult {
  /** 按依赖序装配的「前缀 → Router」(宿主 app.ts 统一挂载) */
  mounts: { prefix: string; router: Router }[];
  prisma: PrismaClient;
}

export function compose(
  prisma: PrismaClient,
  llm: LlmGateway,
  hooks: {
    /** 偏好/BYOK 变更 → 失效 agent 用户上下文缓存 */
    onPrefsChanged?: (info: { userId: string }) => void;
  } = {},
): ComposeResult {
  // ---- 各服务 repository / 端口实现 ----
  const contentRepo = createContentRepository(prisma);
  // identity 提供 UserQueryPort(getUserSummaries + getUserPreferences)
  const usersPort: UserQueryPort = {
    getUserSummaries: (ids: string[]) => getUserSummaries(prisma, ids),
    getUserPreferences: (userId: string) => getUserPreferences(prisma, userId),
  };

  // ---- 服务装配(依赖图无环:identity/content/community/llm 互不依赖,agent 依赖 ports) ----
  // 偏好/BYOK 变更 → 失效 agent 用户上下文缓存。
  // 回调经独立变量提前声明,消除「闭包捕获后续变量」的装配顺序脆弱性:
  // 无论 identity 与 agent 谁先装配,invalidator 都已就绪。
  let invalidateAgentCtx: (info: { userId: string }) => void = () => {};
  const agentRuntime = createAgentRuntime({ prisma, users: usersPort, articles: contentRepo, llm });
  invalidateAgentCtx = ({ userId }) => agentRuntime.memory.invalidateUserContext(userId);
  const agent = createAgentRouter(agentRuntime);

  const identity = createIdentityRouters({
    prisma,
    llm,
    onPrefsChanged: hooks.onPrefsChanged ?? invalidateAgentCtx,
  });
  const content = createContentRouters({ prisma, users: usersPort });
  const community = createCommunityRouters({
    prisma,
    users: usersPort,
    articles: contentRepo,
  });

  return {
    mounts: [
      { prefix: '/api/v1/auth', router: identity.auth },
      { prefix: '/api/v1/settings', router: identity.settings },
      { prefix: '/api/v1/author-applications', router: identity.applications },
      { prefix: '/api/v1/articles', router: content.articles },
      { prefix: '/api/v1/animations', router: content.animations },
      { prefix: '/api/v1/domains', router: content.domains },
      { prefix: '/api/v1/annotations', router: content.annotations },
      { prefix: '/api/v1/topics', router: community.topics },
      { prefix: '/api/v1/agent', router: agent },
    ],
    prisma,
  };
}
