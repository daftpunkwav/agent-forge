import type {
  ApiFormat,
  ByokConfig,
  LlmRequest,
  LlmResponse,
  ProviderConfig,
  StreamChunk,
} from './types.js';
import { extractVisibleAnswer } from './agentPrompt.js';
import {
  LLM_CALL_TIMEOUT_MS,
  LLM_RETRY_BACKOFF_MS,
  LLM_TOKEN_LIMITS,
} from './config.js';
import { logger } from '../logger.js';

/** 上游 LLM 调用错误（A-01）：messageForClient 面向客户端，诊断字段只进日志 */
export class LlmCallError extends Error {
  constructor(
    public readonly status: number,
    public readonly messageForClient: string,
    public readonly diagnostic: { url: string; raw: string },
  ) {
    super(messageForClient);
    this.name = 'LlmCallError';
  }
}

/** 仅 5xx / 网络层失败可重试；4xx（参数/鉴权）与超时、客户端取消不重试（B-05） */
function isRetriable(e: unknown): boolean {
  if (e instanceof LlmCallError) return e.status === 502 || e.status === 503 || e.status === 504;
  // fetch 网络层失败（非 HTTP 状态）表现为 TypeError
  return e instanceof TypeError;
}

function isAbortError(e: unknown): boolean {
  // AbortSignal.timeout 触发时 Node fetch 拒绝的是 name === 'TimeoutError' 的 DOMException，
  // 手动 AbortController 取消则是 'AbortError'——两者都按中断处理
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 同步调用统一加超时（A-02）：调用方 signal 与超时信号任一触发即中断。
 * 返回 timedOut() 用于区分「超时」与「主动取消」。
 */
function withTimeout(req: LlmRequest): { req: LlmRequest; timedOut: () => boolean } {
  const timeoutSignal = AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);
  const signal = req.signal ? AbortSignal.any([req.signal, timeoutSignal]) : timeoutSignal;
  return { req: { ...req, signal }, timedOut: () => timeoutSignal.aborted };
}

/** 防御性兜底：调用方未传参时取单一来源默认（C-03） */
function tokenDefaults(req: LlmRequest): { maxTokens: number; temperature: number } {
  const d = LLM_TOKEN_LIMITS[req.mode === 'fast' ? 'hover' : 'clickDeep'];
  return { maxTokens: req.maxTokens ?? d.maxTokens, temperature: req.temperature ?? d.temperature };
}

function env(name: string, fallback = ''): string {
  return process.env[name] || fallback;
}

function stripSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Anthropic Messages 完整 URL。
 * - base 以 /v1 结尾 → {base}/messages
 * - base 为 step_plan 等根路径 → {base}/v1/messages
 * - base 已含 /messages → 原样
 */
export function resolveAnthropicMessagesUrl(baseUrl: string): string {
  const b = stripSlash(baseUrl);
  if (b.endsWith('/messages')) return b;
  if (/\/v1$/i.test(b)) return `${b}/messages`;
  return `${b}/v1/messages`;
}

export function resolveOpenAiChatUrl(baseUrl: string): string {
  const b = stripSlash(baseUrl);
  if (b.endsWith('/chat/completions')) return b;
  if (/\/v1$/i.test(b)) return `${b}/chat/completions`;
  // 许多兼容网关把 v1 放在 base 内；否则补 /v1
  if (b.includes('/v1')) return `${b}/chat/completions`;
  return `${b}/v1/chat/completions`;
}

export function resolveOpenAiResponsesUrl(baseUrl: string): string {
  const b = stripSlash(baseUrl);
  if (b.endsWith('/responses')) return b;
  if (/\/v1$/i.test(b)) return `${b}/responses`;
  if (b.includes('/v1')) return `${b}/responses`;
  return `${b}/v1/responses`;
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
  return {
    id: 'byok',
    name: byok.name?.trim() || 'BYOK',
    baseUrl: stripSlash(byok.baseUrl.trim()),
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

  // A-02：同步调用统一挂超时，上游挂起 30s 即中断
  const { req: timedReq, timedOut } = withTimeout(req);
  // B-05：5xx/网络抖动重试一次；4xx、超时、客户端取消不重试（避免放大挂起）
  const startedAt = Date.now();
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

  if (p.format === 'anthropic_messages') {
    yield* streamAnthropicMessages(p, req);
    return;
  }
  if (p.format === 'openai_chat') {
    yield* streamOpenAiChat(p, req);
    return;
  }
  // B-04：Responses 格式尚未实现真流式，退化为整段调用后一次性 yield；
  // 首 chunk 延迟 = 整个生成时长，早停对其无效。排障时靠此日志定位。
  logger.warn(
    { providerId: p.id, format: p.format },
    'openai_responses: 未实现真流式，退化为整段输出（早停无效）',
  );
  const full = await callOpenAiResponses(p, req);
  if (full.text) yield { kind: 'text' as const, text: full.text };
}

/** Anthropic Messages 请求体（C-01：覆盖实际用到的字段，替代 Record<string, unknown> + as 断言） */
interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  temperature: number;
  system?: string;
  messages: Array<{ role: string; content: string | unknown[] }>;
  stream?: boolean;
  thinking?: { type: 'disabled' };
}

/** Anthropic Messages 响应体（仅用到字段） */
interface AnthropicResponseBody {
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
  completion?: string;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string };
  message?: string;
  /** JSON 解析失败时的原始文本兜底（错误日志用，不面向客户端） */
  raw?: string;
}

function buildAnthropicBody(p: ProviderConfig, req: LlmRequest, stream: boolean): AnthropicRequestBody {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const { maxTokens, temperature } = tokenDefaults(req);
  const body: AnthropicRequestBody = {
    model: p.model,
    max_tokens: maxTokens,
    temperature,
    system: system || undefined,
    messages,
    stream,
  };
  // 悬停 fast：尽量关闭 extended thinking，减少 CoT 泄漏与延迟
  // StepFun/部分兼容网关可能忽略该字段；忽略时仍靠 extract 净化
  if (req.mode === 'fast') {
    body.thinking = { type: 'disabled' };
  }
  return body;
}

async function* streamAnthropicMessages(
  p: ProviderConfig,
  req: LlmRequest,
): AsyncGenerator<StreamChunk, void, unknown> {
  const url = resolveAnthropicMessagesUrl(p.baseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': p.apiKey,
      authorization: `Bearer ${p.apiKey}`,
      'anthropic-version': '2023-06-01',
      accept: 'text/event-stream',
    },
    body: JSON.stringify(buildAnthropicBody(p, req, true)),
    signal: req.signal,
  });

  if (!res.ok) {
    const raw = await res.text();
    // 若因关闭 thinking 被拒，回退一次不带 thinking 字段
    if (req.mode === 'fast' && (res.status === 400 || res.status === 422)) {
      try {
        const fallbackReq = { ...req, mode: 'deep' as const };
        // 用 deep 只是为了不带 thinking.disabled；仍用原 maxTokens
        const body = buildAnthropicBody(p, fallbackReq, true);
        delete body.thinking;
        body.max_tokens = req.maxTokens ?? LLM_TOKEN_LIMITS.hover.maxTokens;
        body.temperature = req.temperature ?? LLM_TOKEN_LIMITS.hover.temperature;
        const retry = await fetch(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': p.apiKey,
            authorization: `Bearer ${p.apiKey}`,
            'anthropic-version': '2023-06-01',
            accept: 'text/event-stream',
          },
          body: JSON.stringify(body),
          signal: req.signal,
        });
        if (retry.ok && retry.body) {
          yield* readAnthropicSse(retry, p, req);
          return;
        }
      } catch {
        /* fallthrough */
      }
    }
    try {
      const full = await callAnthropicMessages(p, req);
      if (full.thinking) yield { kind: 'thinking' as const, text: full.thinking };
      if (full.text) yield { kind: 'text' as const, text: full.text };
      if (full.text || full.thinking) return;
    } catch {
      /* fallthrough */
    }
    // A-01：错误信息脱敏——url/raw 只进日志，客户端只见安全消息
    throw new LlmCallError(res.status, `模型流式生成失败（HTTP ${res.status}）`, {
      url,
      raw: raw.slice(0, 500),
    });
  }
  if (!res.body) {
    const full = await callAnthropicMessages(p, req);
    if (full.thinking) yield { kind: 'thinking' as const, text: full.thinking };
    if (full.text) yield { kind: 'text' as const, text: full.text };
    return;
  }

  yield* readAnthropicSse(res, p, req);
}

async function* readAnthropicSse(
  res: Response,
  p: ProviderConfig,
  req: LlmRequest,
): AsyncGenerator<StreamChunk, void, unknown> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let textBuf = '';
  let thinkingBuf = '';

  try {
    while (true) {
      if (req.signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() || '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as {
            type?: string;
            delta?: { type?: string; text?: string; thinking?: string };
            content_block?: { type?: string; text?: string; thinking?: string };
          };

          if (evt.type === 'content_block_start' && evt.content_block) {
            const cb = evt.content_block;
            if (cb.type === 'text' && cb.text) {
              textBuf += cb.text;
              yield { kind: 'text' as const, text: cb.text };
            }
            if (cb.type === 'thinking' && cb.thinking) {
              thinkingBuf += cb.thinking;
              yield { kind: 'thinking' as const, text: cb.thinking };
            }
          }

          if (evt.type === 'content_block_delta' && evt.delta) {
            const d = evt.delta;
            if ((d.type === 'text_delta' || d.type === 'text') && d.text) {
              textBuf += d.text;
              yield { kind: 'text' as const, text: d.text };
              continue;
            }
            if (
              (d.type === 'thinking_delta' || d.type === 'thinking') &&
              typeof d.thinking === 'string' &&
              d.thinking
            ) {
              thinkingBuf += d.thinking;
              yield { kind: 'thinking' as const, text: d.thinking };
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e) {
    if (req.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return;
    throw e;
  }

  // 若全程无分片，非流式回退
  if (!textBuf.trim() && !thinkingBuf.trim() && !req.signal?.aborted) {
    const full = await callAnthropicMessages(p, req);
    if (full.thinking) yield { kind: 'thinking' as const, text: full.thinking };
    if (full.text) yield { kind: 'text' as const, text: full.text };
  }
}

async function* streamOpenAiChat(
  p: ProviderConfig,
  req: LlmRequest,
): AsyncGenerator<StreamChunk, void, unknown> {
  const url = resolveOpenAiChatUrl(p.baseUrl);
  const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
  const { maxTokens, temperature } = tokenDefaults(req);
  const body: Record<string, unknown> = {
    model: p.model,
    messages,
    stream: true,
    max_tokens: maxTokens,
    temperature,
  };
  // 部分 OpenAI 兼容网关用这些字段关 reasoning
  if (req.mode === 'fast') {
    body.enable_thinking = false;
    body.reasoning_effort = 'none';
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${p.apiKey}`,
      accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal: req.signal,
  });
  if (!res.ok) {
    const raw = await res.text();
    throw new LlmCallError(res.status, `模型流式生成失败（HTTP ${res.status}）`, {
      url,
      raw: raw.slice(0, 500),
    });
  }
  if (!res.body) {
    const full = await callOpenAiChat(p, req);
    if (full.text) yield { kind: 'text' as const, text: full.text };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (req.signal?.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        break;
      }
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split(/\r?\n/);
      buf = parts.pop() || '';
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const evt = JSON.parse(payload) as {
            choices?: Array<{ delta?: { content?: string; reasoning_content?: string } }>;
          };
          const d = evt.choices?.[0]?.delta;
          if (d?.reasoning_content) yield { kind: 'thinking' as const, text: d.reasoning_content };
          if (d?.content) yield { kind: 'text' as const, text: d.content };
        } catch {
          /* ignore */
        }
      }
    }
  } catch (e) {
    if (req.signal?.aborted || (e instanceof Error && e.name === 'AbortError')) return;
    throw e;
  }
}

async function callAnthropicMessages(p: ProviderConfig, req: LlmRequest): Promise<LlmResponse> {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (m.role === 'user' && req.images?.length && p.vision) {
        const content: unknown[] = [{ type: 'text', text: m.content }];
        for (const img of req.images) {
          if (img.startsWith('data:')) {
            const [meta, data] = img.split(',');
            const mediaType = meta.match(/data:(.*?);/)?.[1] || 'image/png';
            content.push({
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data },
            });
          } else {
            content.push({
              type: 'image',
              source: { type: 'url', url: img },
            });
          }
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });

  // StepFun 等模型可能主要产出 thinking 块，预算过小易截断
  const { maxTokens, temperature } = tokenDefaults(req);
  const url = resolveAnthropicMessagesUrl(p.baseUrl);

  const body: AnthropicRequestBody = {
    model: p.model,
    max_tokens: maxTokens,
    temperature,
    system: system || undefined,
    messages,
  };
  // 悬停：尽量关闭 thinking（网关可能忽略；忽略时靠 extract 净化）
  if (req.mode === 'fast') {
    body.thinking = { type: 'disabled' };
  }

  const doFetch = async (payload: AnthropicRequestBody) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': p.apiKey,
        authorization: `Bearer ${p.apiKey}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload),
      signal: req.signal,
    });
    const raw = await res.text();
    let data: AnthropicResponseBody = {};
    try {
      data = JSON.parse(raw) as AnthropicResponseBody;
    } catch {
      data = { raw: raw.slice(0, 300) };
    }
    return { res, raw, data };
  };

  let { res, raw, data } = await doFetch(body);

  if (!res.ok && req.mode === 'fast' && body.thinking && (res.status === 400 || res.status === 422)) {
    delete body.thinking;
    ({ res, raw, data } = await doFetch(body));
  }

  if (!res.ok) {
    // A-01：url/raw 只进日志，客户端只见安全消息
    throw new LlmCallError(res.status, `模型调用失败（HTTP ${res.status}）`, {
      url,
      raw: raw.slice(0, 500),
    });
  }

  const { text, thinking } = extractAnthropicParts(data);
  const visible = extractVisibleAnswer(thinking, text);
  return {
    text: visible.answer,
    thinking: visible.thinking || thinking,
    model: p.model,
    format: 'anthropic_messages',
    usage: {
      inputTokens: data.usage?.input_tokens,
      outputTokens: data.usage?.output_tokens,
    },
  };
}

export function extractAnthropicParts(data: AnthropicResponseBody): { text: string; thinking: string } {
  const content = data.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    const thoughts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; thinking?: string };
      // D-02：无 type 的块不再当正文兜底（避免把 thinking 块误收为正文）
      if (b.type === 'text' && b.text) texts.push(String(b.text));
      if (b.type === 'thinking' && b.thinking) thoughts.push(String(b.thinking));
    }
    return { text: texts.join(''), thinking: thoughts.join('') };
  }
  if (typeof data.completion === 'string') return { text: data.completion, thinking: '' };
  if (typeof data.output_text === 'string') return { text: data.output_text, thinking: '' };
  return { text: '', thinking: '' };
}

/** OpenAI Chat Completions 响应体（仅用到字段） */
interface OpenAiChatResponseBody {
  choices?: Array<{ message?: { content?: string } }>;
  error?: { message?: string };
  raw?: string;
}

async function callOpenAiChat(p: ProviderConfig, req: LlmRequest): Promise<LlmResponse> {
  const messages = req.messages.map((m) => {
    if (m.role === 'user' && req.images?.length && p.vision) {
      const content: unknown[] = [{ type: 'text', text: m.content }];
      for (const img of req.images) {
        content.push({ type: 'image_url', image_url: { url: img } });
      }
      return { role: m.role, content };
    }
    return m;
  });

  const { maxTokens, temperature } = tokenDefaults(req);
  const url = resolveOpenAiChatUrl(p.baseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      messages,
      max_tokens: maxTokens,
      temperature,
    }),
    // A-02：同步调用统一挂超时（withTimeout 已合成 signal）
    signal: req.signal,
  });
  const raw = await res.text();
  let data: OpenAiChatResponseBody = {};
  try {
    data = JSON.parse(raw) as OpenAiChatResponseBody;
  } catch {
    data = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    // A-01：url/raw 只进日志，客户端只见安全消息
    throw new LlmCallError(res.status, `模型调用失败（HTTP ${res.status}）`, {
      url,
      raw: raw.slice(0, 500),
    });
  }
  const text = data.choices?.[0]?.message?.content || '';
  return { text, model: p.model, format: 'openai_chat' };
}

/** OpenAI Responses 响应体（仅用到字段） */
interface OpenAiResponsesBody {
  output_text?: string;
  output?: unknown;
  error?: { message?: string };
  raw?: string;
}

async function callOpenAiResponses(p: ProviderConfig, req: LlmRequest): Promise<LlmResponse> {
  // C-05：input 用结构化消息数组（与 callOpenAiChat 对齐），不再压成 role: content 纯文本；
  // Responses API 的 system 应放顶层 instructions（部分网关不接受 input 内 role: system）
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const input = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));
  const url = resolveOpenAiResponsesUrl(p.baseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${p.apiKey}`,
    },
    body: JSON.stringify({
      model: p.model,
      input,
      instructions: system || undefined,
      max_output_tokens: tokenDefaults(req).maxTokens,
    }),
    // A-02：同步调用统一挂超时（withTimeout 已合成 signal）
    signal: req.signal,
  });
  const raw = await res.text();
  let data: OpenAiResponsesBody = {};
  try {
    data = JSON.parse(raw) as OpenAiResponsesBody;
  } catch {
    data = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    // A-01：url/raw 只进日志，客户端只见安全消息
    throw new LlmCallError(res.status, `模型调用失败（HTTP ${res.status}）`, {
      url,
      raw: raw.slice(0, 500),
    });
  }
  // A-01 复核：绝不用整个 data（含 raw/error 原始报文）兜底为回答文本；
  // 仅信任 output_text，缺失时尝试结构化 output 数组（模型内容，非报文）
  const outputText = data.output_text || (data.output ? JSON.stringify(data.output).slice(0, 2000) : '');
  return { text: String(outputText), model: p.model, format: 'openai_responses' };
}
