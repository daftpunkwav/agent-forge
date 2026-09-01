import { describe, expect, it, vi } from 'vitest';
import { pickSafeHoverSentence, scheduleMinThinkReveal } from './hoverRevealHelpers';

describe('hoverRevealHelpers', () => {
  it('pickSafeHoverSentence 截断到完整句号', () => {
    const partial = 'ReAct 让模型先思考再行动，适合工具调用场景。后面还在生成';
    expect(pickSafeHoverSentence(partial)).toBe('ReAct 让模型先思考再行动，适合工具调用场景。');
    expect(pickSafeHoverSentence('短')).toBeNull();
  });

  it('scheduleMinThinkReveal 在最短思考后执行', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    scheduleMinThinkReveal({
      minThinkMs: 100,
      startedAt: Date.now(),
      onReveal: fn,
    });
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });
});
