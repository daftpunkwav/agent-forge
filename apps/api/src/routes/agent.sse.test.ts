/**
 * SSE 早停集成测试（A-05）：
 * mock streamLlm 先给 thinking 再给 2 句安全 text → 断言上游 signal 被 abort（早停）、
 * 客户端只收 status/final/done（不收 thinking）、答案写入 L2 缓存。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { LlmRequest, StreamChunk } from '../lib/llm/types.js';

const h = vi.hoisted(() => ({
  streamLlmMock: vi.fn(),
  runToolLoopMock: vi.fn(),
  prismaHoverFindUnique: vi.fn(),
  prismaHoverUpsert: vi.fn(),
  prismaHoverDelete: vi.fn(),
  prismaHoverUpdate: vi.fn(),
  prismaHoverDeleteMany: vi.fn(),
  prismaConvCreate: vi.fn(),
  prismaMsgFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    hoverExplainCache: {
      findUnique: h.prismaHoverFindUnique,
      upsert: h.prismaHoverUpsert,
      delete: h.prismaHoverDelete,
      update: h.prismaHoverUpdate,
      deleteMany: h.prismaHoverDeleteMany,
    },
    agentConversation: {
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      create: h.prismaConvCreate,
      update: vi.fn(),
    },
    agentMessage: { findMany: h.prismaMsgFindMany, createMany: vi.fn(), count: vi.fn() },
    agentMemory: { findMany: vi.fn(), upsert: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn() },
    learningProgress: { findMany: vi.fn() },
    article: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/llm/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/providers.js')>();
  // R-04：路由的 LLM 入口已改为 failover 包装（resolveStreamWithFallback），
  // 测试仍按原语义 mock 单个 provider 的流——包装返回真实单链 + mock 的 stream。
  return {
    ...actual,
    streamLlm: h.streamLlmMock,
    resolveStreamWithFallback: vi.fn(
      async (req: LlmRequest, chain: { provider: { id: string } }[]) => ({
        provider: chain[0],
        stream: h.streamLlmMock(req),
      }),
    ),
  };
});

vi.mock('../lib/llm/tools/index.js', () => ({
  runToolLoop: h.runToolLoopMock,
}));

import { createApp } from '../app.js';
import { LlmCallError, resetProviderCache } from '../lib/llm/providers.js';

let server: Server;
let base = '';

beforeAll(async () => {
  process.env.STEPFUN_API_KEY = 'test-key';
  process.env.STEPFUN_BASE_URL = 'https://llm.example.com';
  process.env.LLM_PROVIDER_ID = 'stepfun';
  resetProviderCache();
  h.prismaHoverFindUnique.mockResolvedValue(null);
  h.prismaHoverUpsert.mockResolvedValue({} as never);
  h.prismaHoverDelete.mockResolvedValue({} as never);
  h.prismaHoverUpdate.mockResolvedValue({} as never);
  h.prismaHoverDeleteMany.mockResolvedValue({ count: 0 } as never);
  const app = createApp();
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
  delete process.env.STEPFUN_API_KEY;
  delete process.env.STEPFUN_BASE_URL;
  delete process.env.LLM_PROVIDER_ID;
  resetProviderCache();
});

describe('POST /agent/explain/stream（悬停）', () => {
  let capturedSignal: AbortSignal | undefined;

  beforeEach(() => {
    capturedSignal = undefined;
    h.streamLlmMock.mockImplementation(
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
    // 完整答案写入 L2 缓存
    expect(h.prismaHoverUpsert).toHaveBeenCalled();
  });

  it('上游 LlmCallError：客户端只收脱敏 error 文案，绝不含 url/raw（A-01 复核）', async () => {
    h.streamLlmMock.mockImplementation(
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
    h.streamLlmMock.mockImplementation(
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
    h.prismaConvCreate.mockResolvedValue({
      id: 'conv-react-1',
      guestKey: 'gk-react-1',
      summary: null,
    });
    h.prismaMsgFindMany.mockResolvedValue([]);
    h.runToolLoopMock.mockImplementation(
      async (opts: { onEvent?: (ev: { type: string; text?: string }) => void }) => {
        opts.onEvent?.({ type: 'delta', text: '工具循环回答。' });
        return {
          answer: '工具循环回答。',
          thinking: '',
          model: 'step-3.7-flash',
          format: 'anthropic_messages',
          iterations: 1,
          hitMaxIters: false,
        };
      },
    );
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
