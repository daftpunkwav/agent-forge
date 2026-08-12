/**
 * Agent 服务的外部依赖端口(ports)。
 * 定义「agent 需要什么」而非「从哪拿」:实现由宿主组合根注入(同进程 delegate 或未来 HTTP 客户端)。
 * 契约类型收敛于 @core/contracts,避免各服务重复定义同形状接口。
 */
import type { ArticleQueryPort, LlmGatewayPort, UserQueryPort } from '@core/contracts';

export type { ArticleQueryPort, LlmGatewayPort, UserQueryPort };

/** Agent 服务的组装依赖(宿主组合根提供全部实现) */
export interface AgentDeps {
  prisma: import('@prisma/client').PrismaClient;
  articles: ArticleQueryPort;
  users: UserQueryPort;
  llm: LlmGatewayPort;
}
