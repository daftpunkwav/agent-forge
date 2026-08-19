/** 跨服务端口契约(composition root 注入用;各服务只声明「需要什么」) */
import type { ByokConfig, LlmRequest, LlmResponse, ProviderConfig, StreamChunk } from './llm-types.js';

// ============================================================================
// 跨服务端口契约(composition root 注入用)
// 各服务只声明「需要什么」,实现由宿主组合根注入。契约类型收敛于此,
// 避免 identity/content/community/agent 各自重复定义同形状接口导致强制转型。
// ============================================================================

/** 用户摘要(序列化作者名用,不耦合 identity 的 User 表结构) */
export interface UserSummary {
  id: string;
  name: string;
}

/** 批量用户摘要查询——identity 提供 */
export interface UserSummaryPort {
  getUserSummaries(ids: string[]): Promise<UserSummary[]>;
}

/** 单用户偏好(含 BYOK 密文)——identity 提供 */
export interface UserPreferencesPort {
  getUserPreferences(userId: string): Promise<{
    agentStyle?: string;
    autoplayAnim?: boolean;
    animSpeed?: number;
    byok?: ByokConfig | null;
  } | null>;
}

export type UserQueryPort = UserSummaryPort & UserPreferencesPort;

/** 文章查询(content 提供)。getArticleBySlug 仅已发布;getArticleMetaBySlug 任意状态 */
export interface ArticleQueryPort {
  getArticleBySlug(
    slug: string,
  ): Promise<{ id: string; slug: string; title: string; summary: string; markdown: string; category: string; level: string } | null>;
  /** 按 slug 取任意状态文章的 id+slug+title(进度校验/记忆标题用) */
  getArticleMetaBySlug(slug: string): Promise<{ id: string; slug: string; title: string } | null>;
  /** 按 slug 取文章 id(community 关联文章用,任意状态) */
  getArticleIdBySlug(slug: string): Promise<string | null>;
  searchArticles(q: string, take: number): Promise<{ title: string; slug: string; summary: string; category: string; level: string }[]>;
  getArticlesByIds(ids: string[]): Promise<{ id: string; title: string; slug: string }[]>;
}

/** LLM 网关错误的结构化形状(llm 服务抛出) */
export interface LlmErrorInfo {
  status?: number;
  diagnostic?: { url?: string; raw?: string };
  messageForClient: string;
}

/** LLM 网关(llm 提供)。密钥与 BYOK 解密只在 llm 内,消费方只经此口调用 */
export interface LlmGatewayPort {
  resolveProvider(byok?: ByokConfig | null): ProviderConfig | null;
  resolveProviderChain(byok?: ByokConfig | null): ProviderConfig[];
  getDefaultProvider(): ProviderConfig | null;
  listPublicProviders(): { id: string; name: string; model: string; format: string; vision: boolean; baseUrlHost: string }[];
  maskApiKey(key: string): string;
  callLlm(req: LlmRequest, provider?: ProviderConfig | null): Promise<LlmResponse>;
  callLlmWithFallback(
    req: LlmRequest,
    chain: ProviderConfig[],
  ): Promise<{ result: LlmResponse; provider: ProviderConfig }>;
  streamLlm(req: LlmRequest, provider?: ProviderConfig | null): AsyncGenerator<StreamChunk, void, unknown>;
  resolveStreamWithFallback(
    req: LlmRequest,
    chain: ProviderConfig[],
  ): Promise<{ provider: ProviderConfig; stream: AsyncGenerator<StreamChunk, void, unknown> }>;
  isLlmCallError(e: unknown): e is LlmErrorInfo;
  llmErrorMessage(e: unknown): string | null;
  llmErrorInfo(e: unknown): LlmErrorInfo | null;
}
