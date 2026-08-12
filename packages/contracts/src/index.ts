/** 共享类型与常量(品牌中立) */

export {
  HOVER_CARD_MAX_SENTENCES,
  HOVER_CARD_MAX_CHARS,
  stripSelfRevisionDraft,
  isLikelyHoverTeaching,
  finalizeHoverCardText,
  progressiveHoverAnswer,
  extractHoverAnswer,
  isCompleteHoverAnswer,
  looksLikeHoverPlanning,
  isSystemEcho,
  isSafeHoverPublicAnswer,
  sanitizeHoverDisplay,
  // 前端别名
  stripSelfRevisionClient,
  isSafeHoverDisplay,
  isLikelyHoverTeachingClient,
} from './hoverSanitize.js';

export type { UserRole, AuthorTier, RuntimeIdentity, Permission, Principal } from './permissions.js';
export {
  can,
  isAuthorLike,
  isAdminLike,
  roleLabel,
} from './permissions.js';

export type ArticleStatus = 'draft' | 'published';

export type ArticleLevel = '入门' | '中级' | '高级';

export type AnimationTemplate =
  | 'react'
  | 'cot'
  | 'tot'
  | 'got'
  | 'loop'
  | 'mcp'
  | 'tool'
  | 'memory'
  | 'harness';

export type ApplicationStatus = 'pending' | 'approved' | 'rejected';
export type ApplicationKind = 'author' | 'elite';

export type ArticleCategory =
  | '推理模式'
  | '框架'
  | '协议'
  | '工程实践'
  | 'LLM基础'
  | '资讯';

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: import('./permissions.js').UserRole;
  authorTier: import('./permissions.js').AuthorTier;
  adminLevel: number;
  bio?: string;
  avatarUrl?: string;
  headline?: string;
  website?: string;
  createdAt: string;
}

export interface DomainSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  track: 'agent' | 'llm' | string;
  sortOrder: number;
  color: string;
  published: boolean;
  articleCount?: number;
}

export interface ArticleSummary {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: ArticleCategory | string;
  level: ArticleLevel | string;
  status: ArticleStatus;
  tags: string[];
  readMinutes: number;
  publishedAt: string | null;
  viewCount: number;
  author?: { id: string; name: string };
  domainId?: string;
  domain?: { id: string; slug: string; name: string };
}

export type AgentStyle = 'professional' | 'friendly' | 'sassy' | 'concise' | 'socratic';

export type LlmApiFormat = 'anthropic_messages' | 'openai_chat' | 'openai_responses';

/** LLM Provider 抽象(与 services/llm 的运行时契约,web 侧仅用于类型) */
export type ApiFormat = LlmApiFormat;

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  messages: ChatMessage[];
  /** 低延迟 / 高准确 */
  mode: 'fast' | 'deep';
  maxTokens?: number;
  temperature?: number;
  /** 多模态：data URL 或 http 图片（若 provider 支持） */
  images?: string[];
  /** 取消进行中的上游 LLM 请求（悬停早停用） */
  signal?: AbortSignal;
}

export interface LlmResponse {
  text: string;
  /** 模型内部思考（可选，不直接当正文展示） */
  thinking?: string;
  model: string;
  format: ApiFormat;
  usage?: { inputTokens?: number; outputTokens?: number };
}

/** 流式分片：思考与正文分离 */
export type StreamChunk =
  | { kind: 'thinking'; text: string }
  | { kind: 'text'; text: string };

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
  /** 是否支持图片输入 */
  vision: boolean;
}

/** 用户 BYOK 配置（存 preferences.byok） */
export interface ByokConfig {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  format: ApiFormat;
  name?: string;
  vision?: boolean;
}

export const API_FORMATS: { id: ApiFormat; label: string; desc: string }[] = [
  {
    id: 'anthropic_messages',
    label: 'Anthropic Messages',
    desc: '原生 /v1/messages（StepFun、Claude 兼容）',
  },
  {
    id: 'openai_chat',
    label: 'OpenAI Chat Completions',
    desc: '/chat/completions',
  },
  {
    id: 'openai_responses',
    label: 'OpenAI Responses',
    desc: '/responses',
  },
];

/** LLM 调用参数预算单一真相来源(agent 组装与 llm 兜底共用) */
export const LLM_TOKEN_LIMITS = {
  /** 悬停快讲：短、直给 */
  hover: { maxTokens: 220, temperature: 0.15 },
  /** 悬停空答案时的极简兜底重试（无记忆、关 thinking） */
  hoverRetry: { maxTokens: 220, temperature: 0.1 },
  /** 面板快答（chat fast） */
  chatFast: { maxTokens: 600, temperature: 0.3 },
  /** 面板/详情深度讲解（chat deep / click deep） */
  chatDeep: { maxTokens: 2048, temperature: 0.55 },
  /** 选中片段深度讲解（click deep） */
  clickDeep: { maxTokens: 2048, temperature: 0.55 },
} as const;

export interface ArticleDetail extends ArticleSummary {
  markdown: string;
  animations?: AnimationDef[];
}

export interface AnimationStep {
  id?: string;
  label: string;
  desc?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

export interface AnimationDef {
  id: string;
  name: string;
  template: AnimationTemplate | string;
  steps: AnimationStep[];
  config?: Record<string, unknown>;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: PublicUser;
}

export interface AuthorApplicationInput {
  field: string;
  bio: string;
  kind?: ApplicationKind;
}

/** 话题帖 */
export interface TopicSummary {
  id: string;
  title: string;
  body: string;
  kind: 'discussion' | 'question' | 'opinion';
  status: string;
  articleId?: string | null;
  article?: { id: string; slug: string; title: string } | null;
  author: { id: string; name: string };
  replyCount: number;
  createdAt: string;
}

export interface AnnotationItem {
  id: string;
  articleId: string;
  userId: string;
  user?: { id: string; name: string };
  anchorText: string;
  sectionId?: string;
  body: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewBy: 'author' | 'agent' | 'admin' | null;
  reviewedAt?: string | null;
  agentNote?: string;
  createdAt: string;
}

/** 文章内动画嵌入语法前缀 */
export const ANIMATION_FENCE = ':::animation';

/** Agent 预留模式 */
export type AgentExplainMode = 'hover' | 'click';

export interface AgentExplainRequest {
  mode: AgentExplainMode;
  selection: {
    text: string;
    sectionId?: string;
    route?: string;
    articleSlug?: string;
    title?: string;
  };
  style?: AgentStyle | string;
}

export const ARTICLE_CATEGORIES: ArticleCategory[] = [
  '推理模式',
  '框架',
  '协议',
  '工程实践',
  'LLM基础',
  '资讯',
];

export const ANIMATION_TEMPLATES: { id: AnimationTemplate; label: string; desc: string }[] = [
  { id: 'react', label: 'ReAct', desc: '推理与行动交替循环' },
  { id: 'cot', label: 'CoT', desc: '思维链逐步推理' },
  { id: 'tot', label: 'ToT', desc: '思维树多路径搜索' },
  { id: 'got', label: 'GoT', desc: '图谱思维关系构建' },
  { id: 'loop', label: 'Loop', desc: 'Agent 核心循环' },
  { id: 'mcp', label: 'MCP', desc: '模型上下文协议通信' },
  { id: 'tool', label: 'Tool Use', desc: '工具调用流程' },
  { id: 'memory', label: 'Memory', desc: '记忆层次与读写' },
  { id: 'harness', label: 'Harness', desc: 'Harness 工程约束与编排' },
];

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
