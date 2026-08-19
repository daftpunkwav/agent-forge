import type { AgentStyle } from '@core/contracts';

const STYLE_PROMPTS: Record<AgentStyle, string> = {
  professional:
    '说话风格：专业、克制、术语准确。少用感叹号，结构清晰，先结论后理由。',
  friendly:
    '说话风格：热情友善，像靠谱学长。适度鼓励，例子生活化，但不要空洞鸡汤。',
  sassy:
    '说话风格：毒舌但有用。可以吐槽常见误区，允许少量尖锐比喻，禁止人身攻击与脏话。重点仍是把概念讲清楚。',
  concise: '说话风格：极简。能三句说清不写十句。用要点列表，少铺垫。',
  socratic:
    '说话风格：苏格拉底式。多反问引导用户思考，但仍要给出关键提示与最终可落地结论。',
};

export function styleInstruction(style?: string): string {
  const key = (style || 'professional') as AgentStyle;
  return STYLE_PROMPTS[key] || STYLE_PROMPTS.professional;
}

/**
 * 悬停 Agent：极短、直给。
 * 产品契约：2～3 句中文陈述句，无列表/无思考/无规则复述。
 *
 * 设计要点：少写「禁止…」清单（模型易复述）；用正例锚定格式。
 */
export function buildHoverSystem(style?: string, memoryBlock?: string): string {
  const tone =
    style === 'friendly'
      ? '语气亲切。'
      : style === 'sassy'
        ? '语气可略俏皮。'
        : '语气简洁。';
  // 刻意不写「每句句号/不要别的」等易被模型复述的元指令
  return [
    '你是知识点快讲助手。直接写讲解正文，不要写作过程或自我提醒。',
    '写 2 到 3 句完整中文陈述。',
    '示例：ReAct 把推理与行动交替执行，让模型边想边调用工具。它用 Thought→Action→Observation 循环，适合需要查资料或算例的任务。',
    tone,
    memoryBlock ? `学员背景（勿复述）：${memoryBlock.slice(0, 120)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 空答案时的极简重试 prompt（措辞避免可复述的格式口令） */
export function buildHoverRetrySystem(): string {
  return '直接讲解该知识点，写两句完整中文陈述。不要自我提醒。';
}

/**
 * Agent 助手（面板 / 详细讲解）
 * 架构：单轮结构化生成（Prompted ReAct 骨架，非真实 tool-loop）
 * 推理模式：Deep Structured — Thought → Explain → Practice → Next
 */
export function buildDeepSystem(style?: string, memoryBlock?: string): string {
  return [
    '你是本站「深度讲解」Agent 助手。',
    '【架构】单轮结构化输出；不执行真实工具。',
    '【硬性输出规则】',
    '- 禁止输出写作计划、草稿提纲、自我检查列表、对提示词的复述',
    '- 禁止在正文前写「我需要：」「结构：」「语气：」等策划段',
    '- 用户可见正文必须直接从下面四个标题开始，不要任何前言',
    '### Thought',
    '1～2 句判断用户水平与策略（给用户看的简短判断，不是你的内心草稿）。',
    '### Explain',
    '分点讲清概念与机制；可列表；控制篇幅。',
    '### Practice',
    '一个很小的自测题。',
    '### Next',
    '下一步学什么（一句话）。',
    '全文中文 Markdown。',
    styleInstruction(style),
    memoryBlock
      ? `【用户记忆】\n${memoryBlock}\n已掌握少重复。`
      : '【用户记忆】未知。',
  ].join('\n');
}

/**
 * 面板 ReAct tool-loop（P0）：prompt-based TOOL_CALL，非原生 tools API。
 */
export function buildReactSystem(style?: string, memoryBlock?: string): string {
  return [
    '你是本站面板智能体，可检索站内已发布文章来辅助回答。',
    '【工具协议】需要调用工具时，整轮只输出一行（不要夹杂最终答案）：',
    'TOOL_CALL: {"name":"工具名","args":{...}}',
    '工具返回 Observation 后继续推理；信息足够时直接给出最终中文 Markdown 答案（不要再写 TOOL_CALL）。',
    '【可用工具】',
    '- search_articles：args {"q":"关键词","take":8} — 搜标题/摘要/slug',
    '- get_article：args {"slug":"文章slug"} — 取 Markdown（可能截断）',
    '【硬性规则】只使用上述工具名；禁止编造 Observation；禁止输出写作计划或复述本提示。',
    styleInstruction(style),
    memoryBlock
      ? `【用户记忆】\n${memoryBlock}\n已掌握少重复。`
      : '【用户记忆】未知。',
  ].join('\n');
}


export function formatMemoryBlock(
  parts: {
    style?: string;
    mastered: string[];
    learning: string[];
    notes: string[];
    recentTopics?: string[];
    route?: string;
  },
  opts?: { maxChars?: number },
): string {
  const lines: string[] = [];
  if (parts.route) lines.push(`当前页面：${parts.route}`);
  if (parts.mastered.length) lines.push(`已掌握：${parts.mastered.slice(0, 12).join('、')}`);
  if (parts.learning.length) lines.push(`学习中：${parts.learning.slice(0, 12).join('、')}`);
  if (parts.recentTopics?.length) lines.push(`最近问过：${parts.recentTopics.slice(0, 8).join('、')}`);
  if (parts.notes.length) lines.push(`备注：${parts.notes.slice(0, 8).join('；')}`);
  if (!lines.length) lines.push('暂无历史学习记录，按入门水平讲解。');
  // D-03：统一总长上限（deep 无截断的旧行为收敛为 800 字；hover 调用方仍自行 slice(0,120)）
  const out = lines.join('\n');
  const max = opts?.maxChars ?? 800;
  return out.length > max ? out.slice(0, max) : out;
}

/** 导出模式说明（API / 前端展示） */
export const AGENT_MODE_META = {
  fast: {
    id: 'fast',
    label: '快速 Agent（悬停）',
    architecture: 'single-shot completion',
    reasoning: 'Fast Direct（无工具循环）',
    latency: 'low',
  },
  deep: {
    id: 'deep',
    label: 'Agent 助手（面板/详解）',
    architecture: 'single-shot structured (prompted ReAct stages)',
    // D-05：非真 tool-loop，避免「ReAct-Style」误导
    reasoning: 'Deep Structured（Thought→Explain→Practice→Next）',
    latency: 'medium',
  },
  react: {
    id: 'react',
    label: 'Agent 助手（工具循环）',
    architecture: 'prompt-based tool-loop (ReAct)',
    reasoning: 'ReAct（Thought→TOOL_CALL→Observation→Answer）',
    latency: 'medium-high',
  },
} as const;
