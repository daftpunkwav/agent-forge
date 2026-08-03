import type { AgentStyle } from './types.js';

// 悬停清洗逻辑已迁移至 @agentforge/shared，此处 re-export 保持现有 API 兼容
export {
  HOVER_CARD_MAX_SENTENCES,
  HOVER_CARD_MAX_CHARS,
  stripSelfRevisionDraft,
  isLikelyHoverTeaching,
  finalizeHoverCardText,
  progressiveHoverAnswer,
  extractHoverAnswer,
  isCompleteHoverAnswer,
  looksLikeHoverPlanning,
  isSafeHoverPublicAnswer,
} from '@agentforge/shared';

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
    '你是 AgentForge「深度讲解」Agent 助手。',
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
 * 从「思考草稿 + 正文」中拆出用户可见答案。
 * StepFun 常把策划/内心独白/反复改稿放在 thinking；悬停绝不可展示。
 */
export function extractVisibleAnswer(thinking: string, text: string): { answer: string; thinking: string } {
  const t = (text || '').trim();
  const th = (thinking || '').trim();

  // 正文已有结构标题：优先正文
  if (t && (/^#{1,3}\s*Thought/im.test(t) || t.length > 40)) {
    if (PLANNING_HINT_LOCAL.test(t.slice(0, 100)) && th) {
      const cleaned = stripPlanningPreamble(t);
      if (cleaned.thinking) return cleaned;
    }
    return { answer: t, thinking: th };
  }

  // 从 thinking 中截取 ### Thought 之后作为答案
  const markers = [
    /^#{1,3}\s*Thought\b/im,
    /^###\s*Thought\b/im,
    /^\*\*Thought\*\*/im,
    /^Thought\s*[:：]/im,
  ];
  for (const re of markers) {
    const m = th.match(re);
    if (m && m.index != null) {
      const answer = th.slice(m.index).trim();
      const thinkingOnly = th.slice(0, m.index).trim();
      if (answer.length > 20) {
        return { answer, thinking: thinkingOnly || th.slice(0, Math.min(200, th.length)) };
      }
    }
  }

  // 去掉明显的策划前缀
  const cleaned = stripPlanningPreamble(th || t);
  if (cleaned.answer) return cleaned;

  if (t) return { answer: t, thinking: th };
  if (th && !PLANNING_HINT_LOCAL.test(th.slice(0, 40))) return { answer: th, thinking: '' };
  if (th) return { answer: '', thinking: th };
  return { answer: '', thinking: '' };
}

// extractVisibleAnswer 内部专用，避免从 shared 重新 import 产生循环依赖风险
const PLANNING_HINT_LOCAL =
  /(?:^|[。！？\n])我需要[:：]|结构如下|写作计划|检查清单|首先得|语气：|当前学习|内部思考|推理过程|Thought\s*[:：]|###\s*Thought|自我提醒|用户想|用户问|用户需要|让我先|我应该|首先分析|判断用户/;

function stripPlanningPreamble(raw: string): { answer: string; thinking: string } {
  const s = raw.trim();
  if (!s) return { answer: '', thinking: '' };
  const exp = s.search(/^#{1,3}\s*Explain\b/im);
  if (exp > 0) {
    return { answer: s.slice(exp).trim(), thinking: s.slice(0, exp).trim() };
  }
  const planLike = /^(我需要|首先|结构|语气|当前学习|要毒舌|用 Thought)/m.test(s);
  if (planLike && s.length > 120) {
    const parts = s.split(/\n{2,}/);
    if (parts.length >= 2) {
      const last = parts[parts.length - 1].trim();
      if (last.length > 40 && !/^(我需要|结构|语气)/.test(last)) {
        return { answer: last, thinking: parts.slice(0, -1).join('\n\n') };
      }
    }
  }
  return { answer: s, thinking: '' };
}

export function formatMemoryBlock(parts: {
  style?: string;
  mastered: string[];
  learning: string[];
  notes: string[];
  recentTopics?: string[];
  route?: string;
}): string {
  const lines: string[] = [];
  if (parts.route) lines.push(`当前页面：${parts.route}`);
  if (parts.mastered.length) lines.push(`已掌握：${parts.mastered.slice(0, 12).join('、')}`);
  if (parts.learning.length) lines.push(`学习中：${parts.learning.slice(0, 12).join('、')}`);
  if (parts.recentTopics?.length) lines.push(`最近问过：${parts.recentTopics.slice(0, 8).join('、')}`);
  if (parts.notes.length) lines.push(`备注：${parts.notes.slice(0, 8).join('；')}`);
  if (!lines.length) lines.push('暂无历史学习记录，按入门水平讲解。');
  return lines.join('\n');
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
    reasoning: 'Deep ReAct-Style（Thought→Explain→Practice→Next）',
    latency: 'medium',
  },
} as const;
