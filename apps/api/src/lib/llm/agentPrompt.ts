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
 * 悬停 Agent：极短、直给。
 * 产品契约：2～3 句中文陈述句，无列表/无思考/无规则复述。
 */
export function buildHoverSystem(style?: string, memoryBlock?: string): string {
  const tone =
    style === 'friendly'
      ? '语气亲切。'
      : style === 'sassy'
        ? '语气可略俏皮。'
        : '语气简洁。';
  return [
    '用中文讲解知识点。',
    '只输出 2 或 3 句完整话，每句以。结尾。',
    '禁止列表、标题、英文指令、自我检查、复述本段说明。',
    tone,
    memoryBlock ? `背景：${memoryBlock.slice(0, 160)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/** 悬停卡片答案硬上限 */
export const HOVER_CARD_MAX_SENTENCES = 3;
export const HOVER_CARD_MAX_CHARS = 220;

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
 *
 * bug-1 典型泄漏：
 * 「首先第一句讲核心：…对，要短…那调整下：…符合要求。有没有冗余？…哦调整下：」
 */
// 注意：勿用裸「我需要」子串（会误杀「当我需要更高吞吐时…」）
const PLANNING_HINT =
  /(?:^|[。！？\n])我需要[:：]|结构如下|写作计划|检查清单|首先得|语气：|当前学习|内部思考|推理过程|Thought\s*[:：]|###\s*Thought|自我提醒|用户想|用户问|用户需要|让我先|我应该|首先分析|判断用户/;

/** 悬停元叙述 / 系统提示复述 */
const HOVER_META =
  /思考过程|写作计划|检查清单|结构如下|自我提醒|内部思考|内部独白|推理过程|推理模式|提纲|大纲|(?:^|[。！？\n])我需要[:：]|我应该|我得先|(?:^|[。！？\n])让我|首先得|首先分析|首先考虑|用户想|用户问|用户需要|用户悬停|用户正在|当前学习|当前用户|当前页面|语气[:：]|风格[:：]|###\s*Thought|Thought\s*[:：]|Action\s*[:：]|Observation\s*[:：]|分析一下|判断用户|水平与策略|不要展开|禁止输出|硬性输出|Fast Direct/i;

/**
 * bug-3：模型把 system「硬性输出规则」复述进正文。
 * 命中任一项 → 该片段/整段不可当讲解。
 */
const SYSTEM_ECHO =
  /只输出最终|禁止任何写作|自我检查|反复修改|每句必须写完|禁止半截|硬性输出|写作过程|对提示词|Fast Direct|禁止输出写作|适合卡片快览|不要讨论|不要任何写作|精炼[：:]\s*[。2]|禁止[「「:]|中文[，,]\s*精炼|以[。．]\s*[-•]|禁止[：:].{0,8}首先|快讲助手|单轮生成|不调用工具/i;

/**
 * bug-4：模型复述 user/system 任务指令（「用户现在需要讲解…要2-3句…第二句：」）。
 * 与知识点正文不同，是 meta 任务叙述。
 */
const TASK_ECHO =
  /用户现在需要|用户需要讲解|需要讲解.{0,12}知识点|要\s*2\s*[-~～到至]?\s*3\s*句|每句句号|句号结尾|只输出讲解|只写\s*2|请用\s*2|知识点[，,].{0,8}要|第[一二三1-3]句\s*[：:]|输出\s*2\s*或\s*3\s*句|完整话[，,].*结尾/i;

/**
 * 自我改稿 / 写作自检（bug-1 / bug-2）
 * 出现在全文任意位置即视为「草稿过程」，不可直接展示。
 */
const SELF_REVISION =
  /那调整下|哦调整|调整下[：:]|等下[，,：:]|哦对[，,：:]|有没有冗余|没有元叙述|符合要求|符合卡片|卡片快览|2\s*[-~～到至]?\s*4\s*句|不要铺垫|要精炼|要短[，,]?\s*不要长|第一句讲|然后讲|类比的话|要不要加|每句完整|直接讲正文|这样三句|首先第一句|对[，,]\s*要短|对[，,]\s*这样|还要提一下|讲清楚了|再顺一点|有没有要避免|或者再顺|两句[，,]讲|核心[、,，]作用[、,，]定位/i;

/** 写作过程旁白短语（可嵌在句中，不能只靠句首匹配） */
const SELF_TALK_PHRASE =
  /还要提一下|讲清楚了|有没有要避免|再顺一点|要不要加|有没有冗余|符合要求|符合卡片|卡片快览|不要铺垫|要精炼|那调整|哦调整|调整下|类比的话|每句完整|直接讲正文|没有元叙述|要短[，,]?\s*不要长|2\s*[-~～到至]?\s*4\s*句|核心[、,，]作用[、,，]定位|或者有没有|或者再顺/i;

/** 单句/单行是否像「作者旁白 / 自检 / 提示词回声」而非知识点讲解 */
function isSelfTalkSentence(s: string): boolean {
  const t = (s || '').trim().replace(/^[-*•]\s+/, '');
  if (!t) return true;
  if (
    SYSTEM_ECHO.test(t) ||
    TASK_ECHO.test(t) ||
    SELF_REVISION.test(t) ||
    HOVER_META.test(t) ||
    PLANNING_HINT.test(t)
  ) {
    return true;
  }
  if (SELF_TALK_PHRASE.test(t)) return true;
  // 半截规则残骸：「精炼：。」「（以。」
  if (/精炼[：:]\s*[。．]?$/.test(t) || /（以[。．]?$/.test(t) || /^[以以]\s*[。．]$/.test(t)) {
    return true;
  }
  // 纯指令 bullet / 过短无知识载荷
  if (t.length < 10 && /禁止|必须|不要|只输出/.test(t)) return true;
  if (
    /^(对[，,]\s*(要短|这样|符合)|哦对|哦|嗯|等下|首先第|然后讲|接着讲|最后讲|要短|符合要求|有没有|类比的话|要不要|第一句|那可以|那调整|那改|好[，,]\s*这样|还要提)/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(首先|然后|接着|最后).{0,12}讲/.test(t)) return true;
  if (t.length < 48 && /讲[^。]{0,20}[：:]\s*$/.test(t)) return true;
  // 悬停答案不应是「写作质量自问」
  if (/[？?]$/.test(t)) {
    if (/还要|有没有|要不要|冗余|顺一点|类比|本质|避免|多余|清楚|两句|三句|调整|铺垫/.test(t)) {
      return true;
    }
    // 纯自问（短问句）
    if (t.length < 36) return true;
  }
  // 提纲枚举：核心、作用、定位
  if (/^[\u4e00-\u9fff]{1,8}([、,，][\u4e00-\u9fff]{1,8}){1,4}[。.]?$/.test(t)) return true;
  if (/符合要求|没有冗余|都是核心点|不要铺垫|精炼一下|讲清楚了|没有多余/.test(t)) return true;
  return false;
}

/**
 * 是否像可保留的「讲解原子单元」。
 * 悬停只收：陈述句 / 术语定义；拒绝对写作过程的疑问句与旁白。
 */
function isTeachingUnit(u: string): boolean {
  const t = (u || '').trim();
  if (t.length < 6) return false;
  if (isSelfTalkSentence(t)) return false;
  if (SELF_TALK_PHRASE.test(t) || SELF_REVISION.test(t)) return false;
  // 悬停：拒绝以？收尾的单元（改稿几乎全是自问）
  if (/[？?]\s*$/.test(t)) return false;
  if (SYSTEM_ECHO.test(t) || SELF_TALK_PHRASE.test(t) || SELF_REVISION.test(t)) return false;
  // 定义体「X：Y」可无句号
  if (/^.{1,48}[：:].{4,}/.test(t) && !/[？?]/.test(t)) return true;
  // 完整陈述句
  if (/[。！]/.test(t)) return true;
  // bullet 拆分后常见：无句号但仍是知识点
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (
    t.length >= 12 &&
    (cn >= 8 || /[A-Za-z]{3,}/.test(t)) &&
    !/禁止|必须|只输出|写作|检查|修改|提示词|精炼/.test(t)
  ) {
    return true;
  }
  return false;
}

/** 清洗单段草稿：按行/句/bullet 原子化过滤（修 bug-2 粘连、bug-3 规则复述） */
function cleanDraftPart(part: string): string {
  let s = (part || '').replace(/\r\n/g, '\n').trim();
  if (!s) return '';
  s = s.replace(/^#{1,3}\s*Explain\b.*\n?/im, '').trim();
  // bug-3：规则与正文用「- 」糊成一团 → 先拆 bullet
  s = s.replace(/\s*[-•]\s+/g, '\n');

  // 原子单元：句末标点 或 换行
  const units = s
    .split(/(?<=[。！？])|\n+/)
    .map((x) => x.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean);

  const kept: string[] = [];
  for (const u of units) {
    // 单元内部若混有旁白/规则回声：只保留前缀
    if (SELF_TALK_PHRASE.test(u) || SYSTEM_ECHO.test(u) || isSelfTalkSentence(u)) {
      const m = u.match(SELF_TALK_PHRASE) || u.match(SYSTEM_ECHO);
      if (m && m.index != null && m.index >= 8) {
        const prefix = u.slice(0, m.index).replace(/[，,、\s]+$/, '').trim();
        if (isTeachingUnit(prefix) || isTeachingUnit(prefix + '。')) {
          const piece = /[。！]$/.test(prefix) ? prefix : `${prefix}。`;
          if (!kept.includes(piece) && !kept.some((k) => k.includes(piece) || piece.includes(k))) {
            kept.push(piece);
          }
        }
      }
      continue;
    }
    if (isTeachingUnit(u)) {
      // 去重：完全相同或已被更长句包含
      if (kept.includes(u)) continue;
      if (kept.some((k) => k === u || (u.length < 40 && k.includes(u)))) continue;
      kept.push(u);
    }
  }

  // 缺句号的知识点后补句号，避免「定义句Chain-of…」粘连
  let out = kept
    .map((k) => {
      if (/[。！？]$/.test(k)) return k;
      return `${k}。`;
    })
    .join('')
    .replace(/\s*\n\s*/g, '')
    .trim();
  // 去掉紧邻重复短语（如标题被写两遍）
  out = out.replace(/(.{10,48})\1+/g, '$1');
  // 定义句无句号时补全感（仅用于完整性检测，不强制改文）
  if (out && !/[。！？]/.test(out) && /^.{1,40}[：:].{4,}/.test(out) && out.length >= 10) {
    // 允许「术语：解释」无句号
  } else if (out && !/[。！？]/.test(out)) {
    // 无任何句读：不输出半截思考
    if (out.length < 24) out = '';
  }

  // 半截：砍到最后 。！
  if (out && !/[。！？]["'」』）)\]]*$/.test(out) && !/^.{1,40}[：:].{4,}$/.test(out)) {
    const end = Math.max(out.lastIndexOf('。'), out.lastIndexOf('！'));
    if (end >= 12) out = out.slice(0, end + 1).trim();
    else if (!/^.{1,40}[：:].{4,}/.test(out)) out = '';
  }

  if (!out) return '';
  if (SYSTEM_ECHO.test(out) || SELF_REVISION.test(out) || SELF_TALK_PHRASE.test(out)) return '';
  // 问号占比过高 = 仍是自检稿
  const q = (out.match(/[？?]/g) || []).length;
  const p = (out.match(/[。！]/g) || []).length;
  if (q > 0 && q >= p) return '';
  return out.slice(0, 600);
}

/**
 * 从改稿长文中抽出「最近一版纯讲解」。
 * 策略：按「调整下」切开，从后往前找第一段完整讲解（末稿常被截断）。
 */
export function stripSelfRevisionDraft(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';

  const revParts = s
    .split(/(?:那|哦)?调整[一一下下]*[：:]|(?:最终版|改成如下|重写如下|正文如下)[：:]/i)
    .map((p) => p.trim())
    .filter(Boolean);

  // 从最后一稿往前：末稿被 maxTokens 截断时回退上一完整版
  if (revParts.length > 1) {
    for (let i = revParts.length - 1; i >= 0; i--) {
      const cleaned = cleanDraftPart(revParts[i]);
      if (cleaned.length >= 20) return cleaned;
    }
  }

  return cleanDraftPart(s);
}

/**
 * 是否像「可展示的纯讲解」（无改稿/自检痕迹）。
 */
export function isLikelyHoverTeaching(s: string): boolean {
  const t = (s || '').trim();
  if (t.length < 10) return false;
  if (SYSTEM_ECHO.test(t) || TASK_ECHO.test(t) || SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) {
    return false;
  }
  if (looksLikeHoverPlanning(t)) return false;
  if (HOVER_META.test(t.slice(0, 160))) return false;
  if (/^(我|让我|用户想|用户问|用户需要|嗯|好的|总之|综上所述|对[，,]\s*(要短|这样)|哦对|还要提)/.test(t)) {
    return false;
  }
  if (/^(首先|其次|然后|最后)(得|要|分析|考虑|判断|想|我|第)/.test(t)) return false;
  if (/^(首先|然后).{0,12}讲/.test(t)) return false;
  // 问号不少于句号 → 自检稿
  const q = (t.match(/[？?]/g) || []).length;
  const p = (t.match(/[。！]/g) || []).length;
  if (q > 0 && q >= Math.max(1, p)) return false;

  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cn < 8) return false;
  // 陈述句
  if (/[。！]/.test(t)) return true;
  // 术语定义「X：Y」（可无句号）
  if (/^.{1,48}[：:].{4,}/.test(t) && !/[？?]/.test(t)) return true;
  if (/^[-*•]\s+\S/m.test(t) && /[。！]/.test(t)) return true;
  return false;
}

/** 从长 thinking 里抽出最像讲解的尾部（教学段），抽不到则空 */
function extractTeachingSpan(raw: string): string {
  const th = (raw || '').trim();
  if (!th) return '';

  // 优先：剥改稿后的纯讲解（覆盖 StepFun 主路径）
  const stripped = stripSelfRevisionDraft(th);
  if (stripped && isLikelyHoverTeaching(stripped)) return stripped;

  // 只认 Explain 后正文
  const exp = th.match(/^#{1,3}\s*Explain\b.*$/im) || th.match(/^\*\*Explain\*\*.*$/im);
  if (exp && exp.index != null) {
    let body = th.slice(exp.index + exp[0].length).replace(/^\s*\n?/, '').trimStart();
    const nextH = body.search(/^#{1,3}\s+\w+/m);
    if (nextH > 0) body = body.slice(0, nextH).trim();
    const clean = stripSelfRevisionDraft(body);
    if (isLikelyHoverTeaching(clean)) return clean.slice(0, 600);
  }

  // 段落：从后往前
  const parts = th.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    const clean = stripSelfRevisionDraft(parts[i]);
    if (isLikelyHoverTeaching(clean)) return clean.slice(0, 600);
    const tail = trailingTeachingSentences(parts[i]);
    if (tail) return tail;
  }

  return trailingTeachingSentences(th);
}

/** 取末尾连续的非元叙述完整句 */
function trailingTeachingSentences(raw: string): string {
  const stripped = stripSelfRevisionDraft(raw);
  if (stripped && isLikelyHoverTeaching(stripped)) return stripped;

  const sentences = raw
    .split(/(?<=[。！？])/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sentences.length) return '';
  let start = sentences.length;
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i];
    if (isSelfTalkSentence(s) || looksLikeHoverPlanning(s) || HOVER_META.test(s)) {
      break;
    }
    start = i;
  }
  if (start >= sentences.length) return '';
  const joined = sentences.slice(start).join('');
  const clean = stripSelfRevisionDraft(joined);
  return isLikelyHoverTeaching(clean) ? clean.slice(0, 600) : '';
}

/**
 * 剥掉「第二句：」「第一句：」等序号壳，露出真正讲解。
 */
function stripSentenceOrdinal(sent: string): string {
  return (sent || '')
    .trim()
    .replace(/^[-*•]\s+/, '')
    .replace(/^第[一二三四五1-5]句\s*[：:]\s*/, '')
    .replace(/^(?:首先|然后|接着|最后)[，,:：]\s*/, '')
    .trim();
}

/**
 * 单句是否可作为悬停卡片讲解（白名单式，偏严）。
 */
function isCleanHoverSentence(sent: string): boolean {
  let t = stripSentenceOrdinal(sent);
  if (t.length < 8 || t.length > 110) return false;
  if (SYSTEM_ECHO.test(t) || TASK_ECHO.test(t) || SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) {
    return false;
  }
  if (HOVER_META.test(t) || PLANNING_HINT.test(t)) return false;
  if (/[？?]/.test(t)) return false;
  // 整句在讲「怎么写」而不是知识点
  if (/要\s*\d\s*[-~～到]?\s*\d\s*句|句号结尾|只输出|需要讲解/.test(t)) return false;
  // 仅拦旁白句首，不误杀「首先，ReAct 是…」类教学句
  if (/^(对[，,]\s*(要短|这样|符合)|哦|嗯|还要提|或者有没有|禁止|只输出|不要输出|中文[，,]|精炼|用户)/.test(t)) {
    return false;
  }
  if (/^(首先|然后).{0,8}讲/.test(t)) return false;
  if (/禁止|必须写完|写作过程|自我检查|反复修改|只输出最终/.test(t)) return false;
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cn < 6) return false;
  return true;
}

/**
 * 最终卡片文案：最多 3 句、约 220 字，仅完整陈述句。
 * 任何旁白/规则回声/改稿过程一律剔除。
 */
export function finalizeHoverCardText(raw: string): string {
  const cleaned = stripSelfRevisionDraft(raw) || (raw || '').trim();
  if (!cleaned) return '';

  const units = cleaned
    .replace(/\s*[-•]\s+/g, '\n')
    .split(/(?<=[。！])|\n+/)
    .map((x) => x.trim())
    .filter(Boolean);

  const kept: string[] = [];
  for (const u of units) {
    if (!isCleanHoverSentence(u)) continue;
    // 去掉「第二句：」壳后再收句
    let body = stripSentenceOrdinal(u);
    if (!body || !isCleanHoverSentence(body)) continue;
    const sent = /[。！]$/.test(body) ? body : `${body}。`;
    if (kept.some((k) => k === sent || (sent.length < 40 && k.includes(sent)) || k.includes(sent.slice(0, 12)))) {
      continue;
    }
    kept.push(sent);
    if (kept.length >= HOVER_CARD_MAX_SENTENCES) break;
  }

  let out = kept.join('');
  if (out.length > HOVER_CARD_MAX_CHARS) {
    let acc = '';
    for (const k of kept) {
      if ((acc + k).length > HOVER_CARD_MAX_CHARS) break;
      acc += k;
    }
    out = acc;
  }

  if (!out || !/[。！]/.test(out)) return '';
  if (SYSTEM_ECHO.test(out) || TASK_ECHO.test(out) || SELF_REVISION.test(out) || SELF_TALK_PHRASE.test(out)) {
    return '';
  }
  if (looksLikeHoverPlanning(out) && !isLikelyHoverTeaching(out)) return '';
  // 至少 1 句、至多 3 句
  const n = (out.match(/[。！]/g) || []).length;
  if (n < 1 || n > HOVER_CARD_MAX_SENTENCES) {
    // 过多则截到 3 句
    if (n > HOVER_CARD_MAX_SENTENCES) {
      let c = 0;
      let end = -1;
      for (let i = 0; i < out.length; i++) {
        if (out[i] === '。' || out[i] === '！') {
          c += 1;
          if (c === HOVER_CARD_MAX_SENTENCES) {
            end = i;
            break;
          }
        }
      }
      if (end > 0) out = out.slice(0, end + 1);
    } else return '';
  }
  return out.slice(0, HOVER_CARD_MAX_CHARS + 20);
}

/**
 * 悬停流式：仅在高置信度为「讲解」时返回可展示正文。
 */
export function progressiveHoverAnswer(thinking: string, text: string): string {
  return finalizeHoverCardText(`${text || ''}\n${thinking || ''}`);
}

/**
 * 悬停专用：统一出口 — 清洗 + 截断为 2～3 句卡片文案。
 */
export function extractHoverAnswer(thinking: string, text: string): string {
  const t = (text || '').trim();
  const th = (thinking || '').trim();
  const tries = [
    finalizeHoverCardText(`${th}\n${t}`),
    finalizeHoverCardText(t),
    finalizeHoverCardText(th),
    finalizeHoverCardText(extractTeachingSpan(th)),
    finalizeHoverCardText(stripSelfRevisionDraft(`${th}\n${t}`)),
  ];
  for (const a of tries) {
    if (a && isLikelyHoverTeaching(a) && !looksLikeHoverPlanning(a)) return a;
  }
  // 次选仍须完整卡片契约，禁止放宽到脏短串
  for (const a of tries) {
    if (a && isCompleteHoverAnswer(a)) return a;
  }
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
  if (t.length < 12 || t.length > HOVER_CARD_MAX_CHARS + 40) return false;
  if (looksLikeHoverPlanning(t)) return false;
  if (SYSTEM_ECHO.test(t) || TASK_ECHO.test(t) || SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) {
    return false;
  }
  if (HOVER_META.test(t.slice(0, 160))) return false;
  if (/讲解失败|暂无讲解|暂无输出|思考过程|推理过程|内部思考|只输出最终|自我检查|用户现在需要|要\s*2\s*[-~]?\s*3\s*句/.test(t)) {
    return false;
  }
  if (/^(我|让我|用户想|用户问|用户需要|首先得|首先要|首先分析|对[，,]|哦|首先第|还要|或者)/.test(t)) {
    return false;
  }
  if (/[，、与和或及]$/.test(t)) return false;
  if (/[？?]/.test(t)) return false;
  if (!/[。！]/.test(t)) return false;
  const n = (t.match(/[。！]/g) || []).length;
  if (n < 1 || n > HOVER_CARD_MAX_SENTENCES) return false;
  return true;
}

export function looksLikeHoverPlanning(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  const head = t.slice(0, 160);
  if (PLANNING_HINT.test(head) || HOVER_META.test(head) || SYSTEM_ECHO.test(t) || TASK_ECHO.test(t)) {
    return true;
  }
  if (SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) return true;
  // 多条「- 禁止/只输出」像在复述规则
  if ((t.match(/[-•]\s*(只输出|禁止|必须|不要)/g) || []).length >= 1) return true;
  if ((head.match(/^[-*]\s+/gm) || []).length >= 2 && /需要|禁止|规则|结构|语气|只输出|写作/.test(head)) {
    return true;
  }
  const q = (t.match(/[？?]/g) || []).length;
  const pCount = (t.match(/[。！]/g) || []).length;
  if (q >= 2) return true;
  if (q > 0 && q >= Math.max(1, pCount)) return true;
  const units = t.split(/(?<=[。！？])|\n+/).map((x) => x.trim()).filter(Boolean);
  if (units.length >= 2) {
    const talk = units.filter((x) => isSelfTalkSentence(x)).length;
    if (talk / units.length >= 0.35) return true;
  }
  return false;
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
