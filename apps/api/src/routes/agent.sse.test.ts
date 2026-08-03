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
  prismaHoverFindUnique: vi.fn(),
  prismaHoverUpsert: vi.fn(),
  prismaHoverDelete: vi.fn(),
  prismaHoverUpdate: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    hoverExplainCache: {
      findUnique: h.prismaHoverFindUnique,
      upsert: h.prismaHoverUpsert,
      delete: h.prismaHoverDelete,
      update: h.prismaHoverUpdate,
    },
    agentConversation: {
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    agentMessage: { findMany: vi.fn(), createMany: vi.fn(), count: vi.fn() },
    agentMemory: { findMany: vi.fn(), upsert: vi.fn(), count: vi.fn(), deleteMany: vi.fn() },
    user: { findUnique: vi.fn() },
    learningProgress: { findMany: vi.fn() },
    article: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/llm/providers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/llm/providers.js')>();
  return { ...actual, streamLlm: h.streamLlmMock };
});

import { createApp } from '../app.js';
import { resetProviderCache } from '../lib/llm/providers.js';

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
});
