/**
 * 工具注册表 / parseToolCall / max-iter 护栏单测
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../prisma.js', () => ({
  prisma: {
    article: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('../providers.js', () => ({
  callLlm: vi.fn(),
}));

vi.mock('../../logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { prisma } from '../../prisma.js';
import { callLlm } from '../providers.js';
import { parseToolCall, hasToolCall } from './parseToolCall.js';
import { executeTool, isAllowlistedTool, listToolNames } from './registry.js';
import { runToolLoop } from './toolLoop.js';
import type { ProviderConfig } from '../types.js';

const provider: ProviderConfig = {
  id: 'test',
  name: 'Test',
  baseUrl: 'https://example.com',
  apiKey: 'sk-test',
  model: 'test-model',
  format: 'openai_chat',
  vision: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseToolCall', () => {
  it('解析单行 TOOL_CALL', () => {
    const r = parseToolCall('TOOL_CALL: {"name":"search_articles","args":{"q":"ReAct"}}');
    expect(r).toEqual({ name: 'search_articles', args: { q: 'ReAct' } });
    expect(hasToolCall('hello')).toBe(false);
  });

  it('非法 JSON → null', () => {
    expect(parseToolCall('TOOL_CALL: {not-json}')).toBeNull();
  });

  it('缺 name → null', () => {
    expect(parseToolCall('TOOL_CALL: {"args":{}}')).toBeNull();
  });
});

describe('tool registry', () => {
  it('白名单仅 search_articles / get_article', () => {
    expect(listToolNames().sort()).toEqual(['get_article', 'search_articles']);
    expect(isAllowlistedTool('search_articles')).toBe(true);
    expect(isAllowlistedTool('web_search')).toBe(false);
  });

  it('未知名 → observation 错误，不抛', async () => {
    const r = await executeTool('rm_rf', {});
    expect(r.ok).toBe(false);
    expect(r.observation).toMatch(/unknown or disallowed/i);
  });

  it('Zod 失败 → observation 错误', async () => {
    const r = await executeTool('search_articles', { q: '' });
    expect(r.ok).toBe(false);
    expect(r.observation).toMatch(/invalid args/i);
  });

  it('search_articles 成功返回 JSON', async () => {
    vi.mocked(prisma.article.findMany).mockResolvedValue([
      {
        title: 'ReAct',
        slug: 'react',
        summary: '推理与行动',
        category: '推理',
        level: '入门',
      },
    ] as never);
    const r = await executeTool('search_articles', { q: 'ReAct', take: 3 });
    expect(r.ok).toBe(true);
    const body = JSON.parse(r.observation) as { count: number; items: { slug: string }[] };
    expect(body.count).toBe(1);
    expect(body.items[0].slug).toBe('react');
  });
});

describe('runToolLoop max iters', () => {
  it('持续 TOOL_CALL 时在 maxIters 停止', async () => {
    vi.mocked(callLlm).mockResolvedValue({
      text: 'TOOL_CALL: {"name":"search_articles","args":{"q":"x"}}',
      thinking: '',
      model: 'test-model',
      format: 'openai_chat',
    });
    vi.mocked(prisma.article.findMany).mockResolvedValue([]);

    const events: string[] = [];
    const result = await runToolLoop({
      provider,
      system: 'sys',
      userContent: '找文章',
      maxTokens: 200,
      maxIters: 3,
      onEvent: (ev) => events.push(ev.type),
    });

    expect(result.hitMaxIters).toBe(true);
    expect(result.iterations).toBe(3);
    expect(result.answer).toMatch(/上限/);
    expect(callLlm).toHaveBeenCalledTimes(3);
    expect(events.filter((t) => t === 'tool_call')).toHaveLength(3);
    expect(events.filter((t) => t === 'tool_result')).toHaveLength(3);
  });

  it('无 TOOL_CALL 时直接返回最终答案', async () => {
    vi.mocked(callLlm).mockResolvedValue({
      text: '### Thought\n简要判断。\n### Explain\nReAct 是…\n### Practice\n?\n### Next\n继续',
      thinking: '',
      model: 'test-model',
      format: 'openai_chat',
    });
    const result = await runToolLoop({
      provider,
      system: 'sys',
      userContent: '什么是 ReAct',
      maxTokens: 200,
      maxIters: 5,
    });
    expect(result.hitMaxIters).toBe(false);
    expect(result.iterations).toBe(1);
    expect(result.answer).toMatch(/ReAct/);
    expect(callLlm).toHaveBeenCalledTimes(1);
  });
});
