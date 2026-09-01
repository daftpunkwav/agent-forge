import type { LlmRequest, LlmResponse, ProviderConfig } from '../types.js';
import { LlmCallError, stripSlash, tokenDefaults } from '../providerHttp.js';
import { providerApiKey } from '../providerSecret.js';

export function resolveOpenAiResponsesUrl(baseUrl: string): string {
  const b = stripSlash(baseUrl);
  if (b.endsWith('/responses')) return b;
  if (/\/v1$/i.test(b)) return `${b}/responses`;
  if (b.includes('/v1')) return `${b}/responses`;
  return `${b}/v1/responses`;
}

/** OpenAI Responses 响应体（仅用到字段） */
interface OpenAiResponsesBody {
  output_text?: string;
  output?: unknown;
  error?: { message?: string };
  raw?: string;
}

export async function callOpenAiResponses(p: ProviderConfig, req: LlmRequest): Promise<LlmResponse> {
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
      authorization: `Bearer ${providerApiKey(p)}`,
    },
    body: JSON.stringify({
      model: p.model,
      input,
      instructions: system || undefined,
      max_output_tokens: tokenDefaults(req).maxTokens,
    }),
    // A-02：同步调用统一挂超时（withTimeout 已合成 signal）
    signal: req.signal,
  redirect: 'manual',
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
