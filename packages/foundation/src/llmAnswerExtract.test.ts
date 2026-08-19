/**
 * extractVisibleAnswer 单测 —— 从「思考草稿 + 正文」拆出用户可见答案。
 * 该函数被 agent 路由(4 处)、toolLoop、llm adapters 共同消费,是共享纯函数的关键守卫。
 */
import { describe, expect, it } from 'vitest';
import { extractVisibleAnswer } from './llmAnswerExtract.js';

describe('extractVisibleAnswer', () => {
  it('正文已有结构标题时优先正文(planning 前言被剥离到 Explain)', () => {
    const r = extractVisibleAnswer(
      '内心草稿',
      '### Thought\n判断。\n### Explain\nReAct 是推理与行动交替的循环。',
    );
    // 正文含 Thought 结构:stripPlanningPreamble 把 Thought 段当前言剥离,answer 从 Explain 起
    expect(r.answer).toContain('### Explain');
    expect(r.answer).toContain('ReAct 是推理与行动交替的循环。');
  });

  it('正文无标题但 >40 字符,回退正文', () => {
    const longBody = '这是一段超过四十个字符的完整讲解正文,用来覆盖没有标题标记的普通情况,请确认能正确回退。';
    expect(longBody.length).toBeGreaterThan(40);
    const r = extractVisibleAnswer('草稿', longBody);
    expect(r.answer).toBe(longBody);
  });

  it('从 thinking 截取 ### Thought 之后作为答案', () => {
    const r = extractVisibleAnswer(
      '先想一下用户水平。\n### Thought\n该用户是入门。\n### Explain\n讲清楚核心概念。',
      '',
    );
    expect(r.answer).toContain('### Explain');
    expect(r.thinking).not.toContain('### Thought');
  });

  it('正文复述 system 规则 → 答案置空(A-04 门控)', () => {
    const r = extractVisibleAnswer(
      '',
      '禁止输出写作计划、草稿提纲、自我检查列表\n- 只输出最终讲解正文\n一些实际内容。',
    );
    expect(r.answer).toBe('');
  });

  it('思考复述规则 → thinking 打码不回传(正文保留)', () => {
    const longBody = '这是一段超过四十个字符的正常讲解正文,用来验证思考复述规则时思考被清空而正文保留的情况。';
    const r = extractVisibleAnswer('禁止输出写作计划、草稿提纲、自我检查列表', longBody);
    expect(r.answer).toBe(longBody);
    expect(r.thinking).toBe('');
  });

  it('全空 → 双空', () => {
    expect(extractVisibleAnswer('', '')).toEqual({ answer: '', thinking: '' });
  });
});
