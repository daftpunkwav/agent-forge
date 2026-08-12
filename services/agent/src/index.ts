/**
 * @core/agent —— Agent 业务域(独立 workspace)。
 * 默认由宿主 services/api 同进程装配;未来拆微服务时可用 createStandaloneAgent 独立启动。
 */
export { createAgentRuntime } from './runtime.js';
export type { AgentRuntime } from './runtime.js';
export { createAgentRouter } from './routes/agent.js';
export type { AgentDeps, ArticleQueryPort, UserQueryPort, LlmGatewayPort } from './ports.js';
