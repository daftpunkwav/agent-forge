/**
 * 流式消费器单测 —— 早停探测、思考门控、status 节流(脱离 Express 直接测)。
 * 这是 #1 深化的直接收益:流式业务逻辑不再只靠宿主 SSE 集成测试兜底。
 */
import { describe, expect, it, vi } from 'vitest';
import { createStreamConsumer } from './streamConsumers.js';

const SAFE_2_SENTENCE =
  'ReAct 把推理与行动交替执行，让模型边想边调用工具。它适合需要查资料或算例的任务。';

describe('deep 模式', () => {
  it('思考经门控后回调;system 复述片段被拦截', () => {
    const onThinking = vi.fn();
    const c = createStreamConsumer({ mode: 'deep', abort: vi.fn(), onThinking });
    c.handle({ kind: 'thinking', text: '禁止输出写作计划、草稿提纲' });
    c.handle({ kind: 'thinking', text: '正常思考内容。' });
    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith('正常思考内容。');
    const r = c.result();
    expect(r.safeThinking).toBe('正常思考内容。');
    expect(r.thinkingAcc).toBe('禁止输出写作计划、草稿提纲正常思考内容。');
  });

  it('文本 delta 直通回调;累计进 textAcc', () => {
    const onText = vi.fn();
    const c = createStreamConsumer({ mode: 'deep', abort: vi.fn(), onText });
    c.handle({ kind: 'text', text: '第一句。' });
    c.handle({ kind: 'text', text: '第二句。' });
    expect(onText).toHaveBeenCalledTimes(2);
    expect(c.result().textAcc).toBe('第一句。第二句。');
  });

  it('不触发早停(earlyAnswer 恒空)', () => {
    const abort = vi.fn();
    const c = createStreamConsumer({ mode: 'deep', abort });
    c.handle({ kind: 'text', text: SAFE_2_SENTENCE });
    expect(c.result().earlyAnswer).toBe('');
    expect(abort).not.toHaveBeenCalled();
  });
});

describe('hover 模式', () => {
  it('思考与文本都不回调(悬停硬规则:客户端只收 status)', () => {
    const onThinking = vi.fn();
    const onText = vi.fn();
    const c = createStreamConsumer({
      mode: 'hover',
      abort: vi.fn(),
      onThinking,
      onText,
      statusThrottleMs: 0,
    });
    c.handle({ kind: 'thinking', text: '让我分析。' });
    c.handle({ kind: 'text', text: '第一句。' });
    expect(onThinking).not.toHaveBeenCalled();
    expect(onText).not.toHaveBeenCalled();
  });

  it('status 节流 100ms', () => {
    vi.useFakeTimers();
    const onStatus = vi.fn();
    const c = createStreamConsumer({ mode: 'hover', abort: vi.fn(), onStatus, statusThrottleMs: 100 });
    c.handle({ kind: 'text', text: 'a' });
    c.handle({ kind: 'text', text: 'b' }); // 同一毫秒,被节流
    expect(onStatus).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(101);
    c.handle({ kind: 'text', text: 'c' });
    expect(onStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('text 达 2 句安全答案 → 早停并 abort', () => {
    const abort = vi.fn();
    const c = createStreamConsumer({ mode: 'hover', topic: 'ReAct', abort, statusThrottleMs: 0 });
    // 单 chunk 字符增量 >60 且 ≥2 句:探测执行并命中早停
    c.handle({ kind: 'text', text: '第一句。' + SAFE_2_SENTENCE });
    // extractHoverAnswer 提取的是干净安全答案(可能剥离引导句),验证含核心句且已触发 abort
    expect(c.result().earlyAnswer).toContain('ReAct 把推理与行动交替执行');
    expect(abort).toHaveBeenCalledTimes(1);
    // 早停后返回 break,且不再回调
    expect(c.handle({ kind: 'text', text: '更多。' })).toBe('break');
  });
});

describe('fast 模式(chat fast)', () => {
  it('思考/文本只发 status,不回调内容;无早停', () => {
    const onStatus = vi.fn();
    const onThinking = vi.fn();
    const c = createStreamConsumer({ mode: 'fast', abort: vi.fn(), onStatus, onThinking });
    c.handle({ kind: 'thinking', text: '想一下' });
    c.handle({ kind: 'text', text: '回答。' });
    expect(onStatus).toHaveBeenCalledTimes(2);
    expect(onThinking).not.toHaveBeenCalled();
    expect(c.result().earlyAnswer).toBe('');
  });
});
