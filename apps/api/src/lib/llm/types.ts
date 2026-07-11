/** LLM Provider 抽象 */

export type ApiFormat =
  | 'anthropic_messages' // Anthropic Messages 原生
  | 'openai_chat' // OpenAI Chat Completions
  | 'openai_responses'; // OpenAI Responses API

export type AgentStyle = 'professional' | 'friendly' | 'sassy' | 'concise' | 'socratic';

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
