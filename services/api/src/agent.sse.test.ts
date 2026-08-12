/**
 * SSE 早停集成测试（A-05）：宿主组合根装配的完整应用。
 * 用注入式 mock prisma + fake LLM 网关验证：
 * 早停中止上游、A-01 脱敏、A-04 思考复述拦截、react 分支 meta 首事件。
 * 这也是「宿主组合根(compose)可组装、agent 域可独立运行」的证据。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { LlmRequest, ProviderConfig, StreamChunk } from '@core/contracts';
import { LlmCallError } from '@core/llm';
import type { LlmGateway } from '@core/llm';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './app.js';

const provider: ProviderConfig = {
  id: 'stepfun',
  name: 'StepFun',
  baseUrl: 'https://llm.example.com',
  apiKey: 'sk-test',
  model: 'step-3.7-flash',
  format: 'anthropic_messages',
  vision: true,
};

const streamLlmMock = vi.fn();
const callLlmMock = vi.fn();

/** 注入式 fake LLM 网关(密钥不外泄,isLlmCallError 用真实 LlmCallError) */
function fakeLlmGateway(): LlmGateway {
  return {
    resolveProvider: () => provider,
    resolveProviderChain: () => [provider],
    getDefaultProvider: () => provider,
    listPublicProviders: () => [{ id: 'stepfun', name: 'StepFun', model: 'step-3.7-flash', format: 'anthropic_messages', vision: true, baseUrlHost: 'llm.example.com' }],
    maskApiKey: (k: string) => (k ? '••••' : ''),
    callLlm: callLlmMock,
    callLlmWithFallback: vi.fn(),
    streamLlm: streamLlmMock,
    resolveStreamWithFallback: async (req: LlmRequest, chain: ProviderConfig[]) => ({
      provider: chain[0],
      stream: streamLlmMock(req),
    }),
    isLlmCallError: (e: unknown): e is LlmCallError => e instanceof LlmCallError,
    llmErrorMessage: (e: unknown) => (e instanceof LlmCallError ? e.messageForClient : null),
    llmErrorInfo: (e: unknown) =>
      e instanceof LlmCallError ? { status: e.status, diagnostic: e.diagnostic, messageForClient: e.messageForClient } : null,
  } as unknown as LlmGateway;
}

function mockPrisma() {
  const h = {
    hoverFindUnique: vi.fn(),
    hoverUpsert: vi.fn(),
    hoverDelete: vi.fn(),
    hoverUpdate: vi.fn(),
    hoverDeleteMany: vi.fn(),
    convCreate: vi.fn(),
    convUpdate: vi.fn(),
    msgFindMany: vi.fn(),
    msgCreateMany: vi.fn(),
    msgCount: vi.fn(),
    memFindMany: vi.fn(),
    memUpsert: vi.fn(),
    memCount: vi.fn(),
    memDeleteMany: vi.fn(),
    articleFindMany: vi.fn(),
    articleFindFirst: vi.fn(),
    articleFindUnique: vi.fn(),
    progressFindMany: vi.fn(),
    progressFindUnique: vi.fn(),
    progressUpsert: vi.fn(),
    userFindUnique: vi.fn(),
  };
  const prisma = {
    hoverExplainCache: {
      findUnique: h.hoverFindUnique,
      upsert: h.hoverUpsert,
      delete: h.hoverDelete,
      update: h.hoverUpdate,
      deleteMany: h.hoverDeleteMany,
    },
    agentConversation: { deleteMany: vi.fn(), findUnique: vi.fn(), create: h.convCreate, update: h.convUpdate },
    agentMessage: { findMany: h.msgFindMany, createMany: h.msgCreateMany, count: h.msgCount },
    agentMemory: { findMany: h.memFindMany, upsert: h.memUpsert, count: h.memCount, deleteMany: h.memDeleteMany },
    article: { findMany: h.articleFindMany, findFirst: h.articleFindFirst, findUnique: h.articleFindUnique },
    learningProgress: { findMany: h.progressFindMany, findUnique: h.progressFindUnique, upsert: h.progressUpsert },
    user: { findUnique: h.userFindUnique },
    $transaction: vi.fn(),
    $queryRaw: vi.fn().mockResolvedValue([{ 1: 1 }]),
    $disconnect: vi.fn(),
  } as unknown as PrismaClient;
  return { prisma, h };
}

let server: Server;
let base = '';
let hoverUpsertMock: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  const { prisma, h } = mockPrisma();
  hoverUpsertMock = h.hoverUpsert;
  h.hoverFindUnique.mockResolvedValue(null);
  h.hoverUpsert.mockResolvedValue({} as never);
  h.hoverDelete.mockResolvedValue({} as never);
  h.hoverUpdate.mockResolvedValue({} as never);
  h.hoverDeleteMany.mockResolvedValue({ count: 0 } as never);
  h.convCreate.mockResolvedValue({ id: 'conv-react-1', guestKey: 'gk-react-1', summary: null } as never);
  h.msgFindMany.mockResolvedValue([]);
  h.msgCreateMany.mockResolvedValue({ count: 2 } as never);
  h.msgCount.mockResolvedValue(0);
  h.articleFindMany.mockResolvedValue([]);

  const app = createApp({ prisma, llm: fakeLlmGateway() });
  await new Promise<void>((resolve, reject) => {
    server = app.listen(0, (err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err?: Error) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

describe('POST /agent/explain/stream（悬停）', () => {
  let capturedSignal: AbortSignal | undefined;

  beforeEach(() => {
    capturedSignal = undefined;
    streamLlmMock.mockImplementation(
      async function* (req: LlmRequest): AsyncGenerator<StreamChunk> {
        capturedSignal = req.signal;
        yield { kind: 'thinking', text: '让我先分析这个知识点的难度与用户背景。' };
        yield {
          kind: 'text',
          // 增量需超过 probe 的 60 字节流阈值，确保早停判定执行
          text: 'ReAct 把推理与行动交替执行，让模型边想边调用工具。它适合需要查资料或算例的任务，也是理解更高级 Agent 框架的基础。',
        };
      },
    );
  });

  it('早停：text 达 2 句 → 中止上游；客户端无 thinking，收 status/final/done，结果入库', async () => {
    const res = await fetch(`${base}/agent/explain/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'hover',
        style: 'professional',
        selection: { text: 'ReAct 是什么', route: '/articles/x' },
      }),
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
    const types = events.map((e) => e.type);
    // 悬停硬规则：思考轨迹绝不下发
    expect(types).not.toContain('thinking');
    expect(types).toContain('status');
    expect(types).toContain('final');
    expect(types[types.length - 1]).toBe('done');
    const final = events.find((e) => e.type === 'final') as { answer?: string };
    expect(final.answer?.length).toBeGreaterThan(0);
    // 早停已中止上游请求
    expect(capturedSignal?.aborted).toBe(true);
    // 完整安全答案写入 L2 缓存(早停后 finalize 入库)
    expect(hoverUpsertMock).toHaveBeenCalled();
  });

  it('上游 LlmCallError：客户端只收脱敏 error 文案，绝不含 url/raw（A-01 复核）', async () => {
    streamLlmMock.mockImplementation(
      async function* (): AsyncGenerator<StreamChunk> {
        // 占位 yield 满足 generator 形态；随后抛上游错误
        yield { kind: 'text', text: '' };
        throw new LlmCallError(502, '模型流式生成失败（HTTP 502）', {
          url: 'https://private-gw.example.com/v1/messages',
          raw: '{"error":"secret trace"}',
        });
      },
    );
    const res = await fetch(`${base}/agent/explain/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'click',
        style: 'professional',
        selection: { text: '什么是 RAG', route: '/articles/x' },
      }),
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
    const err = events.find((e) => e.type === 'error') as { message?: string } | undefined;
    expect(err).toBeDefined();
    // 脱敏断言：安全文案在，私有网关 url / 原始报文不在
    expect(err?.message).toBe('模型流式生成失败（HTTP 502）');
    expect(JSON.stringify(events)).not.toContain('private-gw.example.com');
    expect(JSON.stringify(events)).not.toContain('secret trace');
  });

  it('deep 模式：思考片段命中 system 规则复述被拦截不下发（A-04 复核）', async () => {
    streamLlmMock.mockImplementation(
      async function* (): AsyncGenerator<StreamChunk> {
        yield { kind: 'thinking', text: '禁止输出写作计划、草稿提纲、自我检查列表' };
        yield { kind: 'thinking', text: '这个知识点可以分成概念与应用两部分来讲。' };
        yield { kind: 'text', text: 'RAG 通过检索增强生成，先取回相关文档再让模型作答。' };
      },
    );
    const res = await fetch(`${base}/agent/explain/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'click',
        style: 'professional',
        selection: { text: '什么是 RAG', route: '/articles/x' },
      }),
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
    const thinkingEvents = events.filter((e) => e.type === 'thinking');
    const all = JSON.stringify(events);
    // 复述规则的片段被拦截；正常思考仍可下发
    expect(all).not.toContain('禁止输出写作计划');
    expect(thinkingEvents.length).toBeGreaterThan(0);
  });
});

describe('POST /agent/chat/stream（react 分支）', () => {
  beforeEach(() => {
    callLlmMock.mockImplementation(async (req: LlmRequest) => {
      // 最后一轮(第二轮)给最终答案;其余轮给 TOOL_CALL
      const last = req.messages[req.messages.length - 1];
      if (last?.role === 'user' && /Observation/.test(last.content)) {
        return { text: '### Thought\n简要判断。\n### Explain\nReAct 是推理与行动交替的循环。', thinking: '', model: 'step-3.7-flash', format: 'anthropic_messages' };
      }
      return { text: 'TOOL_CALL: {"name":"search_articles","args":{"q":"ReAct"}}', thinking: '', model: 'step-3.7-flash', format: 'anthropic_messages' };
    });
  });

  it('首个事件为 meta（conversationId/guestKey/reasoningMode=react），随后 delta/final/done', async () => {
    const res = await fetch(`${base}/agent/chat/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '什么是 ReAct', reasoningMode: 'react' }),
    });
    expect(res.ok).toBe(true);
    const text = await res.text();
    const events = text
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
    // 前端 onMeta 是流式路径接收 conversationId/guestKey 的唯一渠道：
    // 缺失会导致多轮上下文丢失、guestKey 不持久化（本用例即该回归的看守）
    expect(events[0]?.type).toBe('meta');
    const meta = events[0] as {
      conversationId?: string;
      guestKey?: string;
      reasoningMode?: string;
      providerId?: string;
    };
    expect(meta.conversationId).toBe('conv-react-1');
    expect(meta.guestKey).toBe('gk-react-1');
    expect(meta.reasoningMode).toBe('react');
    expect(meta.providerId).toBe('stepfun');
    const types = events.map((e) => e.type);
    expect(types).toContain('delta');
    expect(types).toContain('final');
    expect(types[types.length - 1]).toBe('done');
  });
});
