import type { ApiFormat, ProviderConfig } from './types.js';
import { stripSlash } from './providerHttp.js';
import { sealProvider } from './providerSecret.js';

export function readEnv(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

/** 从环境变量构建服务端 Provider 列表（不含缓存） */
export function buildProvidersFromEnv(): ProviderConfig[] {
  const list: ProviderConfig[] = [];

  const stepKey = readEnv('STEPFUN_API_KEY') || readEnv('LLM_API_KEY');
  if (stepKey) {
    list.push({
      id: 'stepfun',
      name: 'StepFun',
      baseUrl: stripSlash(readEnv('STEPFUN_BASE_URL', 'https://api.stepfun.com/step_plan')),
      apiKey: stepKey,
      model: readEnv('STEPFUN_MODEL', 'step-3.7-flash'),
      format: (readEnv('STEPFUN_API_FORMAT', 'anthropic_messages') as ApiFormat) || 'anthropic_messages',
      vision: true,
    });
  }

  const oaiKey = readEnv('OPENAI_API_KEY');
  if (oaiKey) {
    list.push({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: stripSlash(readEnv('OPENAI_BASE_URL', 'https://api.openai.com/v1')),
      apiKey: oaiKey,
      model: readEnv('OPENAI_MODEL', 'gpt-4o-mini'),
      format: (readEnv('OPENAI_API_FORMAT', 'openai_chat') as ApiFormat) || 'openai_chat',
      vision: true,
    });
  }

  const genericKey = readEnv('GENERIC_LLM_API_KEY');
  if (genericKey && readEnv('GENERIC_LLM_BASE_URL')) {
    list.push({
      id: 'generic',
      name: readEnv('GENERIC_LLM_NAME', 'Generic'),
      baseUrl: stripSlash(readEnv('GENERIC_LLM_BASE_URL')),
      apiKey: genericKey,
      model: readEnv('GENERIC_LLM_MODEL', 'default'),
      format: (readEnv('GENERIC_LLM_API_FORMAT', 'openai_chat') as ApiFormat) || 'openai_chat',
      vision: readEnv('GENERIC_LLM_VISION', 'false') === 'true',
    });
  }

  return list.filter((p) => p.baseUrl && p.apiKey).map(sealProvider);
}

let cachedProviders: ProviderConfig[] | null = null;

export function getCachedProviders(): ProviderConfig[] {
  if (!cachedProviders) cachedProviders = buildProvidersFromEnv();
  return cachedProviders;
}

export function resetProviderCache(): void {
  cachedProviders = null;
}

export function getPreferredProviderId(): string {
  return readEnv('LLM_PROVIDER_ID', 'stepfun');
}

export function isByokFallbackToServerEnabled(): boolean {
  return readEnv('LLM_BYOK_FALLBACK_TO_SERVER') === '1';
}
