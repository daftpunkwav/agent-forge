/**
 * providers.ts 纯函数测试（A-05）：
 * URL 解析边界、Anthropic 响应解析、Provider 加载/选择（无需真实 LLM）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  byokToProvider,
  callLlm,
  extractAnthropicParts,
  loadProviders,
  resolveAnthropicMessagesUrl,
  resolveOpenAiChatUrl,
  resolveOpenAiResponsesUrl,
  resetProviderCache,
  resolveProvider,
} from './providers.js';

const KEYS = [
  'STEPFUN_API_KEY',
  'LLM_API_KEY',
  'STEPFUN_BASE_URL',
  'STEPFUN_MODEL',
  'STEPFUN_API_FORMAT',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL',
  'OPENAI_API_FORMAT',
  'GENERIC_LLM_API_KEY',
  'GENERIC_LLM_BASE_URL',
  'GENERIC_LLM_NAME',
  'GENERIC_LLM_MODEL',
  'GENERIC_LLM_API_FORMAT',
  'GENERIC_LLM_VISION',
  'LLM_PROVIDER_ID',
] as const;

beforeEach(() => {
  resetProviderCache();
});

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
  resetProviderCache();
});

describe('resolveAnthropicMessagesUrl', () => {
  it('根路径补 /v1/messages（step_plan 类）', () => {
    expect(resolveAnthropicMessagesUrl('https://api.stepfun.com/step_plan')).toBe(
      'https://api.stepfun.com/step_plan/v1/messages',
    );
  });
  it('/v1 结尾 → 直接补 /messages', () => {
    expect(resolveAnthropicMessagesUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1/messages',
    );
  });
  it('已含 /messages 原样返回', () => {
    expect(resolveAnthropicMessagesUrl('https://example.com/v1/messages')).toBe(
      'https://example.com/v1/messages',
    );
  });
  it('尾斜杠被剥除', () => {
    expect(resolveAnthropicMessagesUrl('https://example.com/v1/')).toBe(
      'https://example.com/v1/messages',
    );
  });
});

describe('resolveOpenAiChatUrl / resolveOpenAiResponsesUrl', () => {
  it('chat: /v1 结尾 → /chat/completions', () => {
    expect(resolveOpenAiChatUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/chat/completions',
    );
  });
  it('chat: 已含 /chat/completions 原样返回', () => {
    expect(resolveOpenAiChatUrl('https://example.com/v1/chat/completions')).toBe(
      'https://example.com/v1/chat/completions',
    );
  });
  it('chat: 根路径补 /v1/chat/completions', () => {
    expect(resolveOpenAiChatUrl('https://gateway.example.com')).toBe(
      'https://gateway.example.com/v1/chat/completions',
    );
  });
  it('responses: /v1 结尾 → /responses', () => {
    expect(resolveOpenAiResponsesUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1/responses',
    );
  });
  it('responses: 已含 /responses 原样返回', () => {
    expect(resolveOpenAiResponsesUrl('https://example.com/v1/responses')).toBe(
      'https://example.com/v1/responses',
    );
  });
  it('responses: 根路径补 /v1/responses', () => {
    expect(resolveOpenAiResponsesUrl('https://gateway.example.com')).toBe(
      'https://gateway.example.com/v1/responses',
    );
  });
});

describe('extractAnthropicParts', () => {
  it('content 数组：text 与 thinking 分离', () => {
    const data = {
      content: [
        { type: 'text', text: '可见正文。' },
        { type: 'thinking', thinking: '内部思考…' },
        { type: 'text', text: '第二段正文。' },
      ],
    };
    expect(extractAnthropicParts(data as never)).toEqual({
      text: '可见正文。第二段正文。',
      thinking: '内部思考…',
    });
  });
  it('无 type 的块不再当正文兜底（D-02）', () => {
    const data = { content: [{ text: '无 type 块' }, { type: 'text', text: '真正文。' }] };
    expect(extractAnthropicParts(data as never)).toEqual({ text: '真正文。', thinking: '' });
  });
  it('completion 字符串兜底', () => {
    expect(extractAnthropicParts({ completion: '旧格式答案' } as never)).toEqual({
      text: '旧格式答案',
      thinking: '',
    });
  });
  it('output_text 字符串兜底', () => {
    expect(extractAnthropicParts({ output_text: 'responses 答案' } as never)).toEqual({
      text: 'responses 答案',
      thinking: '',
    });
  });
  it('空响应', () => {
    expect(extractAnthropicParts({})).toEqual({ text: '', thinking: '' });
  });
});

describe('loadProviders / byokToProvider / resolveProvider', () => {
  it('按环境变量加载并过滤缺 key/baseUrl 的条目', () => {
    process.env.STEPFUN_API_KEY = 'sk-step';
    process.env.STEPFUN_BASE_URL = 'https://api.stepfun.com/step_plan';
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    // generic 缺 BASE_URL → 被过滤
    process.env.GENERIC_LLM_API_KEY = 'sk-generic';
    const list = loadProviders();
    expect(list.map((p) => p.id)).toEqual(['stepfun', 'openai']);
    expect(list[0].format).toBe('anthropic_messages');
  });
  it('模块级缓存：同环境只构造一次，reset 后重读', () => {
    process.env.STEPFUN_API_KEY = 'sk-step';
    process.env.STEPFUN_BASE_URL = 'https://x.example.com';
    const a = loadProviders();
    delete process.env.STEPFUN_API_KEY;
    expect(loadProviders()).toBe(a); // 命中缓存，仍返回旧值
    resetProviderCache();
    expect(loadProviders()).toEqual([]); // 重置后按新环境读取
  });
  it('byokToProvider：enabled=false 或缺字段返回 null', () => {
    expect(byokToProvider({ enabled: false } as never)).toBeNull();
    expect(byokToProvider({ enabled: true, baseUrl: '', apiKey: 'k', model: 'm' } as never)).toBeNull();
    expect(
      byokToProvider({ enabled: true, baseUrl: 'https://x.com', apiKey: 'k', model: 'm' } as never),
    ).toMatchObject({ id: 'byok', format: 'anthropic_messages', vision: true });
  });
  it('resolveProvider：BYOK 优先，无效 BYOK 回退服务端默认', () => {
    const byok = { enabled: true, baseUrl: 'https://byok.example.com', apiKey: 'k', model: 'm' };
    expect(resolveProvider(byok as never)?.id).toBe('byok');
    process.env.STEPFUN_API_KEY = 'sk-step';
    process.env.STEPFUN_BASE_URL = 'https://api.stepfun.com/step_plan';
    expect(resolveProvider({ enabled: false } as never)?.id).toBe('stepfun');
    expect(resolveProvider(null)?.id).toBe('stepfun');
  });
});

describe('callLlm 同步超时信号（A-02 复核）', () => {
  it('openai_chat 同步调用：fetch 收到合并后的 signal（超时/取消任一触发即中断）', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await callLlm({
      mode: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('ok');
    // 关键断言：withTimeout 的合成 signal 必须透传到 fetch，否则超时形同虚设
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockRestore();
  });

  it('openai_responses 同步调用：fetch 收到 signal，且 200+非标准响应不回显原始报文（A-01 复核）', async () => {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    process.env.OPENAI_API_FORMAT = 'openai_responses';
    process.env.LLM_PROVIDER_ID = 'openai';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('not-json-raw-body', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    const result = await callLlm({
      mode: 'deep',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    // 解析失败时 text 必须为空，绝不含原始报文
    expect(result.text).toBe('');
    fetchMock.mockRestore();
  });

  it('anthropic_messages 同步调用：fetch 收到 signal', async () => {
    process.env.STEPFUN_API_KEY = 'sk-step';
    process.env.STEPFUN_BASE_URL = 'https://api.stepfun.com/step_plan';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const result = await callLlm({
      mode: 'fast',
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(result.text).toBe('ok');
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
    fetchMock.mockRestore();
  });
});

describe('callLlm 重试与超时语义（B-05 / A-02 复核）', () => {
  function setupOpenAi() {
    process.env.OPENAI_API_KEY = 'sk-openai';
    process.env.OPENAI_BASE_URL = 'https://api.openai.com/v1';
    process.env.OPENAI_MODEL = 'gpt-4o-mini';
  }
  const okResponse = () =>
    new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const errResponse = (status: number) =>
    new Response(JSON.stringify({ error: `upstream ${status}` }), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  it('5xx 重试一次成功后返回结果（B-05）', async () => {
    setupOpenAi();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(errResponse(502))
      .mockResolvedValueOnce(okResponse());
    const result = await callLlm({ mode: 'fast', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('4xx 不重试，直接抛 LlmCallError（参数/鉴权问题重试无意义）', async () => {
    setupOpenAi();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(errResponse(401));
    await expect(callLlm({ mode: 'fast', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject(
      { status: 401 },
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('网络层 TypeError 重试一次（B-05）', async () => {
    setupOpenAi();
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse());
    const result = await callLlm({ mode: 'fast', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.text).toBe('ok');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fetchMock.mockRestore();
  });

  it('超时 → 抛 LlmCallError(408)（TimeoutError 与 AbortError 都映射为中断）', async () => {
    setupOpenAi();
    // 模拟 withTimeout 的超时信号已触发：AbortSignal.timeout 返回已 aborted 信号
    const timeoutSpy = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort());
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new DOMException('The operation was aborted due to timeout', 'TimeoutError'));
    await expect(callLlm({ mode: 'fast', messages: [{ role: 'user', content: 'hi' }] })).rejects.toMatchObject({
      status: 408,
      messageForClient: '模型响应超时，请稍后重试',
    });
    // 超时后不重试，且诊断字段不含敏感信息
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
    timeoutSpy.mockRestore();
  });
});
