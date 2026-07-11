import type { AgentStyle } from './types.js';

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
 * 快速 Agent（悬停）
 * 架构：单轮 completion / 无工具循环
 * 推理模式：Fast path — 直接答案，禁止长链 CoT / ReAct 轨迹
 */
export function buildHoverSystem(style?: string, memoryBlock?: string): string {
  return [
    '你是 AgentForge「快速讲解」Agent。',
    '【架构】单轮生成，不调用工具。',
    '【推理模式】Fast Direct：内部思考用户不可见，对外只给结论。',
    '【硬性输出规则】',
    '- 只输出最终讲解，禁止输出写作计划、提纲、检查清单、自我提醒',
    '- 禁止「我需要」「首先得」「结构如下」「思考过程」等元叙述',
    '- 禁止输出 Thought/Explain 标题或任何内部推理轨迹',
    '- 中文，精炼：2～4 句完整句子，或最多 4 个短 bullet',
    '- 每句必须写完（以。！？结尾），禁止半截收束',
    '- 1 个类比即可，不要展开成长文',
    '- 适合卡片快览，不要长段落',
    styleInstruction(style),
    memoryBlock
      ? `【用户记忆】\n${memoryBlock}\n已掌握的少讲。`
      : '【用户记忆】未知，按入门极简讲。',
  ].join('\n');
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
 * StepFun 常把策划全文放在 thinking 里，真正结构从 ### Thought 开始。
 */
const PLANNING_HINT =
  /我需要|结构如下|写作计划|检查清单|首先得|语气：|当前学习|内部思考|推理过程|Thought\s*[:：]|###\s*Thought|自我提醒|策划/;

/**
 * 悬停专用：只允许短讲解，拒绝把模型「思考草稿」当正文。
 * StepFun 等常把可用讲解放在 thinking 通道，需从中抢救正文。
 */
export function extractHoverAnswer(thinking: string, text: string): string {
  const t = (text || '').trim();
  const th = (thinking || '').trim();
  const candidates: string[] = [];

  const push = (raw: string) => {
    const v = trimHover(raw);
    if (v.length >= 8 && !PLANNING_HINT.test(v.slice(0, 80))) candidates.push(v);
  };

  if (t) {
    if (!PLANNING_HINT.test(t.slice(0, 80))) push(t);
    else {
      const cleaned = stripPlanningPreamble(t);
      if (cleaned.answer) push(cleaned.answer);
    }
  }

  if (th) {
    // 结构化 ### Explain / Thought 后正文
    const vis = extractVisibleAnswer(th, '');
    if (vis.answer) push(vis.answer);
    // 倒序找像讲解的段落
    const parts = th.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      if (
        p.length >= 12 &&
        p.length <= 800 &&
        !PLANNING_HINT.test(p.slice(0, 60)) &&
        !/^[-*]\s*(需要|禁止|结构|规则)/.test(p)
      ) {
        push(p);
        break;
      }
    }
    // 整段 thinking 去掉策划前缀
    const cleanedTh = stripPlanningPreamble(th);
    if (cleanedTh.answer) push(cleanedTh.answer);
  }

  // 优先「更像完整讲解」的候选
  for (const c of candidates) {
    if (isCompleteHoverAnswer(c)) return c;
  }
  // 次选：任意可用短讲解（避免「暂无讲解」）
  if (candidates[0]) return candidates[0];
  return '';
}

/** 句末优先截断，避免硬切半句 */
function trimHover(s: string, max = 560): string {
  const lines = s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !PLANNING_HINT.test(l));
  let out = lines.join('\n').trim();
  if (out.length <= max) return out;
  const cut = out.slice(0, max);
  const end = Math.max(
    cut.lastIndexOf('。'),
    cut.lastIndexOf('！'),
    cut.lastIndexOf('？'),
    cut.lastIndexOf('.\n'),
    cut.lastIndexOf('!\n'),
    cut.lastIndexOf('?\n'),
    cut.lastIndexOf('\n'),
  );
  if (end >= Math.floor(max * 0.45)) {
    return cut.slice(0, end + 1).trim();
  }
  // 找不到句号：退到最后一个逗号/分号仍优于硬切英文半词
  const soft = Math.max(cut.lastIndexOf('，'), cut.lastIndexOf('；'), cut.lastIndexOf(','));
  if (soft >= Math.floor(max * 0.5)) return cut.slice(0, soft + 1).trim();
  return cut.replace(/[A-Za-z]{1,12}$/, '').trim();
}

/**
 * 缓存质量门：不完整 / 策划稿 / 过短过长 一律不入库。
 * 工业策略：宁可 miss 再请求，也不缓存半截答案二次毒害。
 */
export function isCompleteHoverAnswer(s: string): boolean {
  const t = (s || '').trim();
  if (t.length < 12 || t.length > 900) return false;
  if (PLANNING_HINT.test(t.slice(0, 100))) return false;
  if (/讲解失败|暂无讲解|暂无输出|思考过程/.test(t)) return false;
  // 明显半截：以连词/冒号/顿号收尾
  if (/[，、：:与和或及]$/.test(t)) return false;
  // 很长却无句末标点 → 高概率被截断
  if (t.length > 120 && !/[。！？.!?]["'」』）)\]]*$/.test(t)) {
    if (!/[\u4e00-\u9fffA-Za-z0-9）)」』]{2,24}$/.test(t)) return false;
  }
  return true;
}

/** 是否像内部思考/策划（流式时丢弃） */
export function looksLikeHoverPlanning(s: string): boolean {
  const head = (s || '').trim().slice(0, 120);
  if (!head) return false;
  return (
    PLANNING_HINT.test(head) ||
    /思考过程|推理过程|内部独白|让我先|我应该|首先分析/.test(head)
  );
}

export function extractVisibleAnswer(thinking: string, text: string): { answer: string; thinking: string } {
  const t = (text || '').trim();
  const th = (thinking || '').trim();

  // 正文已有结构标题：优先正文
  if (t && (/^#{1,3}\s*Thought/im.test(t) || t.length > 40)) {
    // 若正文其实是策划稿，仍拆分
    if (PLANNING_HINT.test(t.slice(0, 100)) && th) {
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

  // 去掉明显的策划前缀（「我需要：」「结构：」等大段）
  const cleaned = stripPlanningPreamble(th || t);
  if (cleaned.answer) return cleaned;

  if (t) return { answer: t, thinking: th };
  // 悬停/深度均不应把原始 thinking 当唯一答案时误暴露全过程
  if (th && !PLANNING_HINT.test(th.slice(0, 40))) return { answer: th, thinking: '' };
  if (th) return { answer: '', thinking: th };
  return { answer: '', thinking: '' };
}

function stripPlanningPreamble(raw: string): { answer: string; thinking: string } {
  const s = raw.trim();
  if (!s) return { answer: '', thinking: '' };
  // 若含「### Explain」而无 Thought，从 Explain 切
  const exp = s.search(/^#{1,3}\s*Explain\b/im);
  if (exp > 0) {
    return { answer: s.slice(exp).trim(), thinking: s.slice(0, exp).trim() };
  }
  // 策划段特征：连续「我需要/首先/结构/语气」
  const planLike = /^(我需要|首先|结构|语气|当前学习|要毒舌|用 Thought)/m.test(s);
  if (planLike && s.length > 120) {
    // 尝试找第一个像样的段落作为答案：从最后一个空行后
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
