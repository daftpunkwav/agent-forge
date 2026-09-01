/**
 * @core/llm —— 无状态 LLM 网关(独立 workspace)。
 * 持有全部 LLM 密钥(env provider)与 BYOK 解密后的明文 key,密钥只在本服务内解密。
 * 导出 createLlmGateway():返回符合 agent/identity 端口形状的网关对象。
 */
import {
  callLlm,
  callLlmWithFallback,
  getDefaultProvider,
  listPublicProviders,
  maskApiKey,
  resolveProvider,
  resolveProviderChain,
  resolveStreamWithFallback,
  streamLlm,
} from './providers.js';
import { LlmCallError } from './providerHttp.js';

/** 是否符合 LlmCallError 结构(agent/identity 用) */
function isLlmCallError(e: unknown): e is LlmCallError {
  return e instanceof LlmCallError;
}

/** 安全文案(不含 url/raw);非 LlmCallError 返回 null */
function llmErrorMessage(e: unknown): string | null {
  return isLlmCallError(e) ? e.messageForClient : null;
}

function llmErrorInfo(e: unknown): {
  status?: number;
  diagnostic?: { url?: string; raw?: string };
  messageForClient: string;
} | null {
  if (!isLlmCallError(e)) return null;
  return { status: e.status, diagnostic: e.diagnostic, messageForClient: e.messageForClient };
}

export function createLlmGateway() {
  return {
    resolveProvider,
    resolveProviderChain,
    getDefaultProvider,
    listPublicProviders,
    maskApiKey,
    callLlm,
    callLlmWithFallback,
    streamLlm,
    resolveStreamWithFallback,
    isLlmCallError,
    llmErrorMessage,
    llmErrorInfo,
  };
}

export type LlmGateway = ReturnType<typeof createLlmGateway>;
export { LlmCallError } from './providerHttp.js';
export { resetProviderCache, loadProviders } from './providers.js';
export type { LlmRequest, LlmResponse, ProviderConfig, StreamChunk } from '@core/contracts';
