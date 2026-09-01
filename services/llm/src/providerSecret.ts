/**
 * LLM 密钥封存：出网关的 ProviderConfig.apiKey 恒为空串，
 * 明文挂在不可枚举 Symbol 上，仅 adapter 经 providerApiKey 读取。
 * JSON.stringify / 日志展开因此不会带出 key；测试构造的明文 Provider 仍走 fallback。
 */
import type { ProviderConfig } from './types.js';

const API_KEY = Symbol('llm.apiKey');

type SealedProvider = ProviderConfig & { [API_KEY]?: string };

/** 返回可安全交给调用方的副本（可枚举字段不含明文 key） */
export function sealProvider(p: ProviderConfig): ProviderConfig {
  const existing = (p as SealedProvider)[API_KEY];
  if (existing && !p.apiKey) return p;
  const secret = p.apiKey || existing || '';
  const sealed: ProviderConfig = { ...p, apiKey: '' };
  Object.defineProperty(sealed, API_KEY, {
    value: secret,
    enumerable: false,
    configurable: false,
    writable: false,
  });
  return sealed;
}

/** adapter 取密钥：优先封存槽，其次兼容测试里直接传入的明文 apiKey */
export function providerApiKey(p: ProviderConfig): string {
  return (p as SealedProvider)[API_KEY] || p.apiKey || '';
}
