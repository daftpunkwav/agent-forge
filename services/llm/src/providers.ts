import type {
  ApiFormat,
  ByokConfig,
  LlmRequest,
  LlmResponse,
  ProviderConfig,
  StreamChunk,
} from './types.js';
import { LLM_RETRY_BACKOFF_MS } from './config.js';
import { logger } from '@core/foundation';
import { assertSafeByokBaseUrl } from '@core/foundation';
import {
  LlmCallError,
  isAbortError,
  isRetriable,
  sleep,
  stripSlash,
  withTimeout,
} from './providerHttp.js';
import { callAnthropicMessages, streamAnthropicMessages } from './adapters/anthropicMessages.js';
import { callOpenAiChat, streamOpenAiChat } from './adapters/openaiChat.js';
import { callOpenAiResponses } from './adapters/openaiResponses.js';
import {
  acquireLlmSlot,
  assertCircuitClosed,
  recordProviderFailure,
  recordProviderSuccess,
  releaseCircuitProbe,
} from './resilience.js';

export { LlmCallError } from './providerHttp.js';
export { extractAnthropicParts, resolveAnthropicMessagesUrl } from './adapters/anthropicMessages.js';
export { resolveOpenAiChatUrl } from './adapters/openaiChat.js';
export { resolveOpenAiResponsesUrl } from './adapters/openaiResponses.js';

function env(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

let _providers: ProviderConfig[] | null = null;

/** 从环境变量加载服务端默认 Provider（B-03：进程启动后缓存一次，生产环境变量不热更） */
export function loadProviders(): ProviderConfig[] {
  if (_providers) return _providers;
  const list: ProviderConfig[] = [];

  const stepKey = env('STEPFUN_API_KEY') || env('LLM_API_KEY');
  if (stepKey) {
    list.push({
      id: 'stepfun',
      name: 'StepFun',
      baseUrl: stripSlash(env('STEPFUN_BASE_URL', 'https://api.stepfun.com/step_plan')),
      apiKey: stepKey,
      model: env('STEPFUN_MODEL', 'step-3.7-flash'),
      format: (env('STEPFUN_API_FORMAT', 'anthropic_messages') as ApiFormat) || 'anthropic_messages',
      vision: true,
    });
  }

  const oaiKey = env('OPENAI_API_KEY');
  if (oaiKey) {
    list.push({
      id: 'openai',
      name: 'OpenAI',
      baseUrl: stripSlash(env('OPENAI_BASE_URL', 'https://api.openai.com/v1')),
      apiKey: oaiKey,
      model: env('OPENAI_MODEL', 'gpt-4o-mini'),
      format: (env('OPENAI_API_FORMAT', 'openai_chat') as ApiFormat) || 'openai_chat',
      vision: true,
    });
  }

  const genericKey = env('GENERIC_LLM_API_KEY');
  if (genericKey && env('GENERIC_LLM_BASE_URL')) {
    list.push({
      id: 'generic',
      name: env('GENERIC_LLM_NAME', 'Generic'),
      baseUrl: stripSlash(env('GENERIC_LLM_BASE_URL')),
      apiKey: genericKey,
      model: env('GENERIC_LLM_MODEL', 'default'),
      format: (env('GENERIC_LLM_API_FORMAT', 'openai_chat') as ApiFormat) || 'openai_chat',
      vision: env('GENERIC_LLM_VISION', 'false') === 'true',
    });
  }

  _providers = list.filter((p) => p.baseUrl && p.apiKey);
  return _providers;
}

/** 仅测试用：重置 Provider 缓存，便于按用例切换环境变量 */
export function resetProviderCache(): void {
  _providers = null;
}

export function getDefaultProvider(): ProviderConfig | null {
  const preferred = env('LLM_PROVIDER_ID', 'stepfun');
  const all = loadProviders();
  return all.find((p) => p.id === preferred) || all[0] || null;
}

export function byokToProvider(byok?: ByokConfig | null): ProviderConfig | null {
  if (!byok?.enabled) return null;
  if (!byok.baseUrl?.trim() || !byok.apiKey?.trim() || !byok.model?.trim()) return null;
  // SSRF：仅校验用户 BYOK；服务端 env Provider 不走此路径
  const baseUrl = assertSafeByokBaseUrl(byok.baseUrl);
  return {
    id: 'byok',
    name: byok.name?.trim() || 'BYOK',
    baseUrl,
    apiKey: byok.apiKey.trim(),
    model: byok.model.trim(),
    format: byok.format || 'anthropic_messages',
    vision: byok.vision !== false,
  };
}

/** 优先用户 BYOK，其次服务端默认 */
export function resolveProvider(byok?: ByokConfig | null): ProviderConfig | null {
  return byokToProvider(byok) || getDefaultProvider();
}

/**
 * R-04：Provider 故障转移链。顺序：BYOK（如启用且允许）→ 首选服务端 → 其余服务端。
 * BYOK 失败默认不回落服务端（配额隔离）；LLM_BYOK_FALLBACK_TO_SERVER=1 显式开启。
 */
export function resolveProviderChain(byok?: ByokConfig | null): ProviderConfig[] {
  const chain: ProviderConfig[] = [];
  const byokP = byokToProvider(byok);
  if (byokP) chain.push(byokP);
  const all = loadProviders();
  if (!byokP || process.env.LLM_BYOK_FALLBACK_TO_SERVER === '1') {
    const preferred = env('LLM_PROVIDER_ID', 'stepfun');
    const sorted = [...all].sort((a, b) =>
      a.id === preferred ? -1 : b.id === preferred ? 1 : 0,
    );
    chain.push(...sorted);
  }
  return chain;
}

export type LlmChainResult = { result: LlmResponse; provider: ProviderConfig };

/** R-04：该错误是否触发 failover（上游故障类：网络/5xx/超时/429/熔断 503）；4xx 配置错误直接抛 */
function isFailoverError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  if (!(e instanceof LlmCallError)) return false;
  // code='LLM_CAPACITY' 是本地并发满（与具体 provider 无关），沿链重试只会白等，直接终止
  if (e.code === 'LLM_CAPACITY') return false;
  return [408, 429, 500, 502, 503, 504].includes(e.status);
}

/**
 * R-04：沿链 failover。仅「上游故障类」错误（5xx/网络/超时/429/熔断 503）触发；
 * 4xx 配置错误直接抛，不 failover。响应带实际服务者 provider。
 */
export async function callLlmWithFallback(
  req: LlmRequest,
  chain: ProviderConfig[],
): Promise<LlmChainResult> {
  let lastErr: unknown = new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  for (const p of chain) {
    try {
      const result = await callLlm(req, p);
      return { result, provider: p };
    } catch (e) {
      lastErr = e;
      const failover = isFailoverError(e);
      logger.warn(
        {
          event: 'llm_failover',
          providerId: p.id,
          status: e instanceof LlmCallError ? e.status : undefined,
          failover,
        },
        'llm provider failed',
      );
      if (!failover) throw e;
    }
  }
  throw lastErr;
}

/**
 * R-04：流式 failover——只尝试「首个 chunk 之前」的失败（熔断/5xx/网络/超时/429）。
 * 已开始产出 chunk 后不再切换 provider（避免双份内容）。
 * 返回实际服务 provider 与从首个 chunk 开始可迭代的生成器（meta 可用 servedBy 精确下发）。
 */
export async function resolveStreamWithFallback(
  req: LlmRequest,
  chain: ProviderConfig[],
): Promise<{ provider: ProviderConfig; stream: AsyncGenerator<StreamChunk, void, unknown> }> {
  let lastErr: unknown = new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  for (const p of chain) {
    const gen = streamLlm(req, p);
    try {
      const first = await gen.next();
      if (first.done) {
        // 空流也算成功（provider 正常但无产出）——返回空流，不再尝试备选
        const empty = (async function* () {})();
        return { provider: p, stream: empty };
      }
      const buffered = first.value;
      return {
        provider: p,
        stream: (async function* () {
          yield buffered;
          yield* gen;
        })(),
      };
    } catch (e) {
      lastErr = e;
      const failover = isFailoverError(e);
      logger.warn(
        {
          event: 'llm_stream_failover',
          providerId: p.id,
          status: e instanceof LlmCallError ? e.status : undefined,
          failover,
        },
        'llm stream provider failed',
      );
      if (!failover) throw e;
    }
  }
  throw lastErr;
}

export function listPublicProviders() {
  return loadProviders().map((p) => ({
    id: p.id,
    name: p.name,
    model: p.model,
    format: p.format,
    vision: p.vision,
    baseUrlHost: safeHost(p.baseUrl),
  }));
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export async function callLlm(req: LlmRequest, provider?: ProviderConfig | null): Promise<LlmResponse> {
  const p = provider || getDefaultProvider();
  if (!p) {
    throw new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  }

  // R-01：熔断开路时快速失败，不给垂死上游继续加压
  assertCircuitClosed(p);
  // R-02：进程级并发名额；满员排队 LLM_QUEUE_WAIT_MS，超时 503 降级
  const releaseSlot = await acquireLlmSlot();

  // A-02：同步调用统一挂超时，上游挂起 30s 即中断
  const { req: timedReq, timedOut } = withTimeout(req);
  // B-05：5xx/网络抖动重试一次；4xx、超时、客户端取消不重试（避免放大挂起）
  const startedAt = Date.now();
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        let result: LlmResponse;
        switch (p.format) {
          case 'anthropic_messages':
            result = await callAnthropicMessages(p, timedReq);
            break;
          case 'openai_responses':
            result = await callOpenAiResponses(p, timedReq);
            break;
          case 'openai_chat':
          default:
            result = await callOpenAiChat(p, timedReq);
            break;
        }
        // B-06：成功打点
        logger.info(
          {
            event: 'llm_call',
            providerId: p.id,
            format: p.format,
            mode: req.mode,
            ms: Date.now() - startedAt,
            ok: true,
          },
          'llm call ok',
        );
        // R-01：成功复位熔断
        recordProviderSuccess(p);
        return result;
      } catch (e) {
        if (attempt === 1 && !timedOut() && isRetriable(e)) {
          // B-06：重试打点
          logger.warn(
            {
              event: 'llm_call_retry',
              providerId: p.id,
              format: p.format,
              mode: req.mode,
              status: e instanceof LlmCallError ? e.status : undefined,
            },
            'llm call retry',
          );
          await sleep(LLM_RETRY_BACKOFF_MS);
          continue;
        }
        // R-01：最终失败计入熔断（内部已过滤 4xx/主动取消）
        recordProviderFailure(p, e);
        if (isAbortError(e) && timedOut()) {
          logger.error(
            {
              event: 'llm_call',
              providerId: p.id,
              format: p.format,
              mode: req.mode,
              ms: Date.now() - startedAt,
              ok: false,
              status: 408,
            },
            'llm call timeout',
          );
          throw new LlmCallError(408, '模型响应超时，请稍后重试', { url: '', raw: '' });
        }
        // B-06：失败打点（TypeError=网络层失败，标记 NETWORK 便于日志聚合区分）
        logger.error(
          {
            event: 'llm_call',
            providerId: p.id,
            format: p.format,
            mode: req.mode,
            ms: Date.now() - startedAt,
            ok: false,
            status: e instanceof LlmCallError ? e.status : e instanceof TypeError ? 'NETWORK' : undefined,
          },
          'llm call failed',
        );
        throw e;
      }
    }
    /* istanbul ignore next -- 循环上限内必返回或抛错 */
    throw new Error('unreachable');
  } finally {
    releaseSlot();
  }
}

/** 流式输出：thinking / text 分片。openai_responses 退化为整段 text。 */
export async function* streamLlm(
  req: LlmRequest,
  provider?: ProviderConfig | null,
): AsyncGenerator<StreamChunk, void, unknown> {
  const p = provider || getDefaultProvider();
  if (!p) {
    throw new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  }

  // R-01 + R-02：熔断检查 + 名额占满整个流式生命周期
  assertCircuitClosed(p);
  let releaseSlot: (() => void) | null = null;
  try {
    releaseSlot = await acquireLlmSlot();
  } catch (e) {
    // P0-1：槽位排队超时发生在调用之前——探测标记需复位，否则该 provider 后续请求全 503
    releaseCircuitProbe(p);
    throw e;
  }

  // A-02：流式同样挂超时，避免上游挂起拖垮 SSE
  const { req: timedReq, timedOut } = withTimeout(req);
  let finished = false;
  try {
    if (p.format === 'anthropic_messages') {
      yield* streamAnthropicMessages(p, timedReq);
      finished = true;
      return;
    }
    if (p.format === 'openai_chat') {
      yield* streamOpenAiChat(p, timedReq);
      finished = true;
      return;
    }
    // B-04：Responses 格式尚未实现真流式，退化为整段调用后一次性 yield；
    // 首 chunk 延迟 = 整个生成时长，早停对其无效。排障时靠此日志定位。
    logger.warn(
      { providerId: p.id, format: p.format },
      'openai_responses: 未实现真流式，退化为整段输出（早停无效）',
    );
    const full = await callOpenAiResponses(p, timedReq);
    if (full.text) yield { kind: 'text' as const, text: full.text };
    finished = true;
  } catch (e) {
    // R-01：真实故障计入熔断；hover 早停/客户端断开属主动取消，不计（内部已过滤）
    recordProviderFailure(p, e);
    if (isAbortError(e) && timedOut()) {
      throw new LlmCallError(408, '模型响应超时，请稍后重试', { url: '', raw: '' });
    }
    throw e;
  } finally {
    releaseSlot?.();
    // P0-1：流未正常结束（早停/客户端断开走 finally 而非 catch）时解除半开探测标记，
    // 防止「探测在飞」永久卡死；正常结束由 recordProviderSuccess 关闭熔断。
    if (!finished) releaseCircuitProbe(p);
    else recordProviderSuccess(p);
  }
}
