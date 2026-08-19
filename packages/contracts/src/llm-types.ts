/** LLM 类型与参数常量(agent 组装与 llm 网关共用) */
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
