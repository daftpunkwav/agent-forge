/** 领域 DTO(共享线格式) */
import type { AgentStyle } from './llm-types.js';

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
