/**
 * 悬停 L2 缓存（A-05）：key 版本化、命中/过期/脏数据、hits≥8 走 24h TTL、写库质检。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    hoverExplainCache: {
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma.js';
import { getHoverCache, hoverCacheKey, setHoverCache } from './hoverCache.js';

/** 可通过 isSafeHoverPublicAnswer 的 2 句安全答案 */
const SAFE_ANSWER =
  'ReAct 把推理与行动交替执行，让模型边想边调用工具。它适合需要查资料或算例的任务。';
const DIRTY_ANSWER = '思考过程：先想一下用户要什么，写作计划…';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.hoverExplainCache.delete).mockResolvedValue({} as never);
  vi.mocked(prisma.hoverExplainCache.update).mockResolvedValue({} as never);
  vi.mocked(prisma.hoverExplainCache.upsert).mockResolvedValue({} as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('hoverCacheKey', () => {
  it('同 topic+style 稳定；不同 topic/style 不同 key；sha256 无明文', () => {
    const a = hoverCacheKey('ReAct', 'professional');
    expect(a).toBe(hoverCacheKey('ReAct', 'professional'));
    expect(a).not.toBe(hoverCacheKey('CoT', 'professional'));
    expect(a).not.toBe(hoverCacheKey('ReAct', 'sassy'));
    expect(a).toHaveLength(48);
    expect(a).not.toContain('ReAct');
  });
  it('大小写/空白归一化', () => {
    expect(hoverCacheKey('  ReAct  ', 'professional')).toBe(hoverCacheKey('react', 'professional'));
  });
});

describe('getHoverCache', () => {
  it('miss 返回 null', async () => {
    vi.mocked(prisma.hoverExplainCache.findUnique).mockResolvedValue(null);
    expect(await getHoverCache('ReAct', 'professional')).toBeNull();
  });

  it('脏数据直接删除并返回 null', async () => {
    vi.mocked(prisma.hoverExplainCache.findUnique).mockResolvedValue({
      cacheKey: 'k',
      answer: DIRTY_ANSWER,
      hits: 1,
      updatedAt: new Date(),
    } as never);
    expect(await getHoverCache('ReAct', 'professional')).toBeNull();
    expect(prisma.hoverExplainCache.delete).toHaveBeenCalled();
  });

  it('默认 TTL 2h：超过即过期', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T00:00:00Z'));
    vi.mocked(prisma.hoverExplainCache.findUnique).mockResolvedValue({
      cacheKey: 'k',
      answer: SAFE_ANSWER,
      hits: 1,
      updatedAt: new Date('2026-08-02T21:00:00Z'), // 3h 前
    } as never);
    expect(await getHoverCache('ReAct', 'professional')).toBeNull();
  });

  it('hits≥8 走 24h TTL：3h 前仍命中', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T00:00:00Z'));
    vi.mocked(prisma.hoverExplainCache.findUnique).mockResolvedValue({
      cacheKey: 'k',
      answer: SAFE_ANSWER,
      hits: 10,
      updatedAt: new Date('2026-08-02T21:00:00Z'),
    } as never);
    expect(await getHoverCache('ReAct', 'professional')).toBe(SAFE_ANSWER);
    expect(prisma.hoverExplainCache.update).toHaveBeenCalled(); // hits+1
  });

  it('正常命中返回答案并递增 hits', async () => {
    vi.mocked(prisma.hoverExplainCache.findUnique).mockResolvedValue({
      cacheKey: 'k',
      answer: SAFE_ANSWER,
      hits: 3,
      updatedAt: new Date(),
    } as never);
    expect(await getHoverCache('ReAct', 'professional')).toBe(SAFE_ANSWER);
    expect(prisma.hoverExplainCache.update).toHaveBeenCalled();
  });
});

describe('setHoverCache', () => {
  it('脏答案不写入（质检门）', async () => {
    await setHoverCache('ReAct', 'professional', DIRTY_ANSWER);
    expect(prisma.hoverExplainCache.upsert).not.toHaveBeenCalled();
  });
  it('安全答案写入', async () => {
    await setHoverCache('ReAct', 'professional', SAFE_ANSWER);
    expect(prisma.hoverExplainCache.upsert).toHaveBeenCalled();
  });
});
