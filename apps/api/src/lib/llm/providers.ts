import type {
  ApiFormat,
  ByokConfig,
  LlmRequest,
  LlmResponse,
  ProviderConfig,
  StreamChunk,
} from './types.js';
import { extractVisibleAnswer } from './agentPrompt.js';

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

/** 从环境变量加载服务端默认 Provider */
export function loadProviders(): ProviderConfig[] {
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

  return list.filter((p) => p.baseUrl && p.apiKey);
}

export function getDefaultProvider(): ProviderConfig | null {
  const preferred = env('LLM_PROVIDER_ID', 'stepfun');
  const all = loadProviders();
  return all.find((p) => p.id === preferred) || all[0] || null;
}

export function byokToProvider(byok: ByokConfig): ProviderConfig | null {
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
  return byokToProvider(byok || ({ enabled: false } as ByokConfig)) || getDefaultProvider();
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

  switch (p.format) {
    case 'anthropic_messages':
      return callAnthropicMessages(p, req);
    case 'openai_responses':
      return callOpenAiResponses(p, req);
    case 'openai_chat':
    default:
      return callOpenAiChat(p, req);
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

  if (p.format === 'anthropic_messages') {
    yield* streamAnthropicMessages(p, req);
    return;
  }
  if (p.format === 'openai_chat') {
    yield* streamOpenAiChat(p, req);
    return;
  }
  const full = await callOpenAiResponses(p, req);
  if (full.text) yield { kind: 'text' as const, text: full.text };
}

function buildAnthropicBody(p: ProviderConfig, req: LlmRequest, stream: boolean) {
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const messages = req.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }));

  const maxTokens = req.maxTokens ?? (req.mode === 'fast' ? 900 : 2048);
  const temperature = req.temperature ?? (req.mode === 'fast' ? 0.25 : 0.55);
  const body: Record<string, unknown> = {
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
        body.max_tokens = req.maxTokens ?? 220;
        body.temperature = req.temperature ?? 0.15;
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
    throw new Error(`LLM 流式失败 (${res.status}) @ ${url}: ${raw.slice(0, 240)}`);
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
  const body: Record<string, unknown> = {
    model: p.model,
    messages,
    stream: true,
    max_tokens: req.maxTokens ?? (req.mode === 'fast' ? 512 : 1600),
    temperature: req.temperature ?? (req.mode === 'fast' ? 0.25 : 0.55),
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
    throw new Error(`LLM 流式失败 (${res.status}) @ ${url}: ${raw.slice(0, 240)}`);
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
  const maxTokens = req.maxTokens ?? (req.mode === 'fast' ? 900 : 2048);
  const temperature = req.temperature ?? (req.mode === 'fast' ? 0.3 : 0.6);
  const url = resolveAnthropicMessagesUrl(p.baseUrl);

  const body: Record<string, unknown> = {
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

  const doFetch = async (payload: Record<string, unknown>) => {
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
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(raw) as Record<string, unknown>;
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
    const msg =
      (data as { error?: { message?: string } })?.error?.message ||
      (data as { message?: string })?.message ||
      raw.slice(0, 200) ||
      res.statusText;
    throw new Error(`LLM 调用失败 (${res.status}) @ ${url}: ${msg}`);
  }

  const { text, thinking } = extractAnthropicParts(data);
  const visible = extractVisibleAnswer(thinking, text);
  return {
    text: visible.answer,
    thinking: visible.thinking || thinking,
    model: p.model,
    format: 'anthropic_messages',
    usage: {
      inputTokens: (data.usage as { input_tokens?: number } | undefined)?.input_tokens,
      outputTokens: (data.usage as { output_tokens?: number } | undefined)?.output_tokens,
    },
  };
}

function extractAnthropicParts(data: Record<string, unknown>): { text: string; thinking: string } {
  const content = data.content;
  if (Array.isArray(content)) {
    const texts: string[] = [];
    const thoughts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as { type?: string; text?: string; thinking?: string };
      if (b.type === 'text' && b.text) texts.push(String(b.text));
      else if (b.text && !b.type) texts.push(String(b.text));
      if (b.type === 'thinking' && b.thinking) thoughts.push(String(b.thinking));
    }
    return { text: texts.join(''), thinking: thoughts.join('') };
  }
  if (typeof data.completion === 'string') return { text: data.completion, thinking: '' };
  if (typeof data.output_text === 'string') return { text: data.output_text, thinking: '' };
  return { text: '', thinking: '' };
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
      max_tokens: req.maxTokens ?? (req.mode === 'fast' ? 256 : 1024),
      temperature: req.temperature ?? (req.mode === 'fast' ? 0.3 : 0.6),
    }),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    data = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message || raw.slice(0, 200) || res.statusText;
    throw new Error(`LLM 调用失败 (${res.status}) @ ${url}: ${msg}`);
  }
  const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
  const text = choices?.[0]?.message?.content || '';
  return { text, model: p.model, format: 'openai_chat' };
}

async function callOpenAiResponses(p: ProviderConfig, req: LlmRequest): Promise<LlmResponse> {
  const input = req.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
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
      max_output_tokens: req.maxTokens ?? (req.mode === 'fast' ? 256 : 1024),
    }),
  });
  const raw = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    data = { raw: raw.slice(0, 300) };
  }
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } })?.error?.message || raw.slice(0, 200) || res.statusText;
    throw new Error(`LLM 调用失败 (${res.status}) @ ${url}: ${msg}`);
  }
  const outputText =
    (data.output_text as string) || JSON.stringify(data.output || data).slice(0, 2000);
  return { text: String(outputText), model: p.model, format: 'openai_responses' };
}
