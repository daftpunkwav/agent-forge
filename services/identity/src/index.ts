/**
 * @core/identity —— 认证/用户/作者申请/设置 域(独立 workspace)。
 * 工厂注入 PrismaClient 与 LLM 网关端口(settings test-llm 用)。
 * 默认由宿主同进程装配;未来独立进程 = 提供 HTTP 客户端实现后调用。
 */
import { Router } from 'express';
import { createAuthRouter } from './routes/auth.js';
import { createApplicationsRouter } from './routes/applications.js';
import { createSettingsRouter } from './routes/settings.js';
import type { LlmGatewayPort } from './ports.js';

export interface IdentityDeps {
  prisma: import('@prisma/client').PrismaClient;
  llm: LlmGatewayPort;
  /** 偏好/BYOK 变更后回调(宿主注入,失效 agent 上下文缓存) */
  onPrefsChanged?: (info: { userId: string }) => void;
}

export interface IdentityRouters {
  auth: Router;
  applications: Router;
  settings: Router;
}

export function createIdentityRouters(deps: IdentityDeps): IdentityRouters {
  return {
    auth: createAuthRouter(deps.prisma),
    applications: createApplicationsRouter(deps.prisma),
    settings: createSettingsRouter(deps),
  };
}

/** 独立装配(standalone 用):合并成单一 Router */
export function createIdentityRouter(deps: IdentityDeps): Router {
  const { auth, applications, settings } = createIdentityRouters(deps);
  return Router().use(auth, applications, settings);
}

export { getUserSummaries, getUserPreferences } from './repositories.js';
export type { LlmGatewayPort, UserQueryPort } from './ports.js';
