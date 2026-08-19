/**
 * Agent Prompt 构建器单测 —— 测试 agentPrompt.ts 的本地逻辑(非 contracts 的 hover 净化)。
 * 构建器是 agent 域的 prompt 组装,与悬停净化(contracts/hoverSanitize)分离。
 */
import { describe, expect, it } from 'vitest';
import {
  AGENT_MODE_META,
  buildDeepSystem,
  buildHoverRetrySystem,
  buildHoverSystem,
  buildReactSystem,
  formatMemoryBlock,
  styleInstruction,
} from './agentPrompt.js';

describe('styleInstruction', () => {
  it('默认专业风格;未知风格回退专业', () => {
    expect(styleInstruction()).toContain('专业');
    expect(styleInstruction('sassy')).toContain('毒舌');
    expect(styleInstruction('unknown')).toContain('专业');
  });
});

describe('buildHoverSystem', () => {
  it('包含 2-3 句约束与示例,不含记忆时无 memory 行', () => {
    const sys = buildHoverSystem('professional');
    expect(sys).toContain('2 到 3 句完整中文陈述');
    expect(sys).toContain('ReAct');
    expect(sys).not.toContain('学员背景');
  });
  it('记忆块被截断到 120 字符且标注勿复述', () => {
    const sys = buildHoverSystem('friendly', 'x'.repeat(300));
    expect(sys).toContain('学员背景（勿复述）');
    const line = sys.split('\n').find((l) => l.includes('学员背景'))!;
    expect(line.length).toBeLessThan(140);
  });
});

describe('buildHoverRetrySystem', () => {
  it('极简两句指令', () => {
    expect(buildHoverRetrySystem()).toContain('两句完整中文陈述');
  });
});

describe('buildDeepSystem', () => {
  it('四个标题齐全且以 Thought 开头(无前言)', () => {
    const sys = buildDeepSystem('professional', '');
    const lines = sys.split('\n').filter(Boolean);
    expect(lines[0]).toBe('你是本站「深度讲解」Agent 助手。');
    expect(sys).toContain('### Thought');
    expect(sys).toContain('### Explain');
    expect(sys).toContain('### Practice');
    expect(sys).toContain('### Next');
  });
  it('记忆未知时给默认行;有记忆时嵌入', () => {
    expect(buildDeepSystem('professional')).toContain('【用户记忆】未知。');
    expect(buildDeepSystem('professional', '已掌握 ReAct')).toContain('已掌握 ReAct');
  });
});

describe('buildReactSystem', () => {
  it('声明工具协议与白名单工具', () => {
    const sys = buildReactSystem('professional');
    expect(sys).toContain('TOOL_CALL');
    expect(sys).toContain('search_articles');
    expect(sys).toContain('get_article');
  });
});

describe('formatMemoryBlock', () => {
  it('各分节组装;空时给默认行', () => {
    const block = formatMemoryBlock({ mastered: ['ReAct'], learning: ['MCP'], notes: ['偏好简答'], route: '/articles/x' });
    expect(block).toContain('当前页面：/articles/x');
    expect(block).toContain('已掌握：ReAct');
    expect(block).toContain('学习中：MCP');
    expect(block).toContain('备注：偏好简答');
    expect(formatMemoryBlock({ mastered: [], learning: [], notes: [] })).toContain('暂无历史学习记录');
  });
  it('总长受 maxChars 截断', () => {
    const long = formatMemoryBlock(
      { mastered: [], learning: [], notes: ['n'.repeat(2000)] },
      { maxChars: 100 },
    );
    expect(long.length).toBeLessThanOrEqual(100);
  });
});

describe('AGENT_MODE_META', () => {
  it('fast/deep/react 三种模式齐全且带 label', () => {
    expect(Object.keys(AGENT_MODE_META).sort()).toEqual(['deep', 'fast', 'react']);
    expect(AGENT_MODE_META.fast.label).toContain('快速');
  });
});
