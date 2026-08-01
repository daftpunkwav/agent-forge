/**
 * 行内 / 对话框悬停讲解共用 L1 缓存
 * TTL 20min · LRU 64 · 仅完整且安全的讲解（拒绝思考轨迹 / 改稿过程）
 */

type Entry = { text: string; at: number };

const TTL_MS = 20 * 60 * 1000;
const MAX = 64;
const store = new Map<string, Entry>();

/** 与 AgentFloat 等监听者同步清空内存缓存 */
export const AGENT_CACHE_CLEARED_EVENT = 'agentforge:agent-cache-cleared';

/** 清空浏览器端 L1 悬停缓存，并广播事件供气泡组件清空各自 Map */
export function clearAllHoverCaches(): number {
  const n = store.size;
  store.clear();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent(AGENT_CACHE_CLEARED_EVENT, { detail: { clearedL1: n } }),
    );
  }
  return n;
}

/** 与后端 SELF_REVISION / SELF_TALK_PHRASE 对齐（全文扫描） */
const SELF_REVISION =
  /那调整下|哦调整|调整下[：:]|等下[，,：:]?|哦对[，,：:]|有没有冗余|没有元叙述|符合要求|符合卡片|卡片快览|2\s*[-~～到至]?\s*4\s*句|不要铺垫|要精炼|要短[，,]?\s*不要长|第一句讲|然后讲|讲核心|讲边界|讲接口|类比的话|要不要加|用户说|每句完整|每句结尾句号|直接讲正文|这样三句|1\s*个类比|一个类比|要自然|首先第一句|对[，,]\s*要短|对[，,]\s*这样|还要提一下|没有多余|讲清楚了|再顺一点|有没有要避免|或者再顺|两句[，,]讲|核心[、,，]作用[、,，]定位|不要别的/i;

const SELF_TALK_PHRASE =
  /还要提一下|没有多余|讲清楚了|有没有要避免|再顺一点|要不要加|有没有冗余|符合要求|符合卡片|卡片快览|不要铺垫|要精炼|那调整|哦调整|调整下|等下要|类比的话|用户说|每句完整|每句结尾句号|直接讲正文|没有元叙述|要短[，,]?\s*不要长|2\s*[-~～到至]?\s*4\s*句|核心[、,，]作用[、,，]定位|或者有没有|或者再|不要别的/i;

const PLANNING =
  /思考过程|写作计划|(?:^|[。！？\n])我需要[:：]|结构如下|###\s*Thought|Thought\s*[:：]|推理过程|内部思考|内部独白|讲解失败|暂无讲解|用户想|用户问|用户需要|用户悬停|让我先|我应该|我得先|首先分析|首先得|判断用户|当前学习|当前用户|检查清单|自我提醒|提纲|大纲|水平与策略|Action\s*[:：]|Observation\s*[:：]|Fast Direct|硬性输出|禁止输出/i;

/** bug-3：复述 system 规则 */
const SYSTEM_ECHO =
  /只输出最终|禁止任何写作|自我检查|反复修改|每句必须写完|禁止半截|硬性输出|写作过程|对提示词|Fast Direct|禁止输出写作|适合卡片快览|不要讨论|不要任何写作|精炼[：:]\s*[。2]|中文[，,]\s*精炼|快讲助手|单轮生成|不调用工具|不要别的|不要自我提醒/i;

/** bug-4 / 格式口令复述 */
const TASK_ECHO =
  /用户现在需要|用户需要讲解|需要讲解.{0,12}知识点|要\s*2\s*[-~～到至]?\s*3\s*句|每句句号|每句结尾句号|结尾句号|句号结尾|只输出讲解|第[一二三1-3]句\s*[：:]|输出\s*2\s*或\s*3\s*句|不要别的|要准确.{0,8}句号|写两句完整|只输出这两句/i;

function looksTruncatedTeachingTail(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return true;
  const body = t.replace(/[。！]+$/, '');
  if (/[的与和及于在被把将可更越很太]$/.test(body) && body.length < 80) return true;
  const opens = (t.match(/[“「"]/g) || []).length;
  const closes = (t.match(/[”」"]/g) || []).length;
  if (opens > closes) return true;
  return false;
}

function isSelfTalkSentence(s: string): boolean {
  const t = (s || '').trim().replace(/^[-*•]\s+/, '');
  if (!t) return true;
  if (
    SYSTEM_ECHO.test(t) ||
    TASK_ECHO.test(t) ||
    SELF_REVISION.test(t) ||
    PLANNING.test(t) ||
    SELF_TALK_PHRASE.test(t)
  ) {
    return true;
  }
  if (/精炼[：:]\s*[。．]?$/.test(t) || /（以[。．]?$/.test(t)) return true;
  if (
    /^(对[，,！!]|哦|嗯|等下|首先第|然后讲|接着讲|最后讲|讲[核心边界接口]|要短|不要|符合|有没有|类比|要不要|用户说|第一句|那可以|那调整|还要|或者|比如|例如|譬如)/.test(
      t,
    )
  ) {
    return true;
  }
  if (/^(首先|然后|接着|最后).{0,12}讲/.test(t)) return true;
  if (t.length < 48 && /讲[^。]{0,20}[：:]\s*$/.test(t)) return true;
  if (/[？?]$/.test(t)) {
    if (/还要|有没有|要不要|冗余|顺一点|类比|本质|避免|多余|清楚|两句|三句|调整|铺垫/.test(t)) {
      return true;
    }
    if (t.length < 36) return true;
  }
  if (/^[\u4e00-\u9fff]{1,8}([、,，][\u4e00-\u9fff]{1,8}){1,4}[。.]?$/.test(t)) return true;
  if (/符合要求|没有冗余|都是核心点|不要铺垫|讲清楚了|没有多余/.test(t)) return true;
  if (/^(比如|例如|譬如)[：:「"“]?/.test(t)) return true;
  if (looksTruncatedTeachingTail(t)) return true;
  return false;
}

function isTeachingUnitClient(u: string): boolean {
  const t = (u || '').trim();
  if (t.length < 6) return false;
  if (isSelfTalkSentence(t) || SELF_TALK_PHRASE.test(t)) return false;
  if (/[？?]\s*$/.test(t)) return false;
  if (/^.{1,40}[：:].{4,}/.test(t) && !/[？?]/.test(t)) return true;
  if (/[。！]/.test(t)) return true;
  if (/^[-*•]\s+\S{4,}/.test(t) && !/[？?]/.test(t)) return true;
  return false;
}

function cleanDraftPartClient(part: string): string {
  let s = (part || '').replace(/\r\n/g, '\n').trim();
  if (!s) return '';
  s = s.replace(/^#{1,3}\s*Explain\b.*\n?/im, '').trim();
  s = s.replace(/\s*[-•]\s+/g, '\n');
  const units = s
    .split(/(?<=[。！？])|\n+/)
    .map((x) => x.trim().replace(/^[-*•]\s+/, ''))
    .filter(Boolean);
  const kept: string[] = [];
  for (const u of units) {
    if (SELF_TALK_PHRASE.test(u) || isSelfTalkSentence(u)) {
      const m = u.match(SELF_TALK_PHRASE);
      if (m && m.index != null && m.index >= 8) {
        const prefix = u.slice(0, m.index).replace(/[，,、\s]+$/, '').trim();
        if (isTeachingUnitClient(prefix)) kept.push(prefix);
      }
      continue;
    }
    if (isTeachingUnitClient(u)) kept.push(u);
  }
  let out = kept.join('').replace(/\s*\n\s*/g, '').trim();
  if (out && !/[。！？]/.test(out) && !/^.{1,48}[：:].{4,}/.test(out)) {
    if (out.length < 24) out = '';
  }
  if (out && !/[。！？]["'」』）)\]]*$/.test(out) && !/^.{1,48}[：:].{4,}$/.test(out)) {
    const end = Math.max(out.lastIndexOf('。'), out.lastIndexOf('！'));
    if (end >= 12) out = out.slice(0, end + 1).trim();
    else if (!/^.{1,48}[：:].{4,}/.test(out)) out = '';
  }
  if (
    !out ||
    SYSTEM_ECHO.test(out) ||
    TASK_ECHO.test(out) ||
    SELF_REVISION.test(out) ||
    SELF_TALK_PHRASE.test(out)
  ) {
    return '';
  }
  const q = (out.match(/[？?]/g) || []).length;
  const p = (out.match(/[。！]/g) || []).length;
  if (q > 0 && q >= p) return '';
  return out.slice(0, 600);
}

/** 前端剥改稿：从后往前取最近完整一版（与后端一致） */
export function stripSelfRevisionClient(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  const revParts = s
    .split(/(?:那|哦)?调整[一一下下]*[：:]|(?:最终版|改成如下|重写如下|正文如下)[：:]/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (revParts.length > 1) {
    for (let i = revParts.length - 1; i >= 0; i--) {
      const cleaned = cleanDraftPartClient(revParts[i]);
      if (cleaned.length >= 20) return cleaned;
    }
  }
  return cleanDraftPartClient(s);
}

function looksLikePlanning(s: string): boolean {
  const t = (s || '').trim();
  if (!t) return false;
  if (PLANNING.test(t.slice(0, 200)) || SYSTEM_ECHO.test(t) || TASK_ECHO.test(t)) return true;
  if (SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) return true;
  if ((t.match(/[-•]\s*(只输出|禁止|必须|不要)/g) || []).length >= 1) return true;
  const q = (t.match(/[？?]/g) || []).length;
  const p = (t.match(/[。！]/g) || []).length;
  if (q >= 2) return true;
  if (q > 0 && q >= Math.max(1, p)) return true;
  const units = t.split(/(?<=[。！？])|\n+/).map((x) => x.trim()).filter(Boolean);
  if (units.length >= 2) {
    const talk = units.filter((x) => isSelfTalkSentence(x)).length;
    if (talk / units.length >= 0.35) return true;
  }
  return false;
}

/** 是否像可展示的讲解（前端兜底门控） */
export function isLikelyHoverTeachingClient(s: string): boolean {
  const t = (s || '').trim();
  if (t.length < 10) return false;
  if (looksLikePlanning(t)) return false;
  if (SYSTEM_ECHO.test(t) || TASK_ECHO.test(t) || SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) {
    return false;
  }
  if (/^(我|让我|用户想|用户问|用户需要|嗯|好的|总之|对[，,]|哦|首先第|还要|或者|等下|比如|例如|譬如)/.test(t)) {
    return false;
  }
  if (/^(首先|其次|然后|最后)(得|要|分析|考虑|判断|想|我|第)/.test(t)) return false;
  if (/^(首先|然后).{0,12}讲/.test(t)) return false;
  const q = (t.match(/[？?]/g) || []).length;
  const p = (t.match(/[。！]/g) || []).length;
  if (q > 0 && q >= Math.max(1, p)) return false;
  const cn = (t.match(/[\u4e00-\u9fff]/g) || []).length;
  if (cn < 8) return false;
  const units = t.split(/(?<=[。！])/).map((x) => x.trim()).filter(Boolean);
  if (units.some((u) => isSelfTalkSentence(u) || looksTruncatedTeachingTail(u))) return false;
  if (/[。！]/.test(t)) return true;
  if (/^.{1,48}[：:].{4,}/.test(t) && !/[？?]/.test(t)) return true;
  return false;
}

/** 对外可展示：2～3 句陈述 + 无旁白（卡片契约） */
export function isSafeHoverDisplay(s: string): boolean {
  const t = (s || '').trim();
  if (t.length < 12 || t.length > 260) return false;
  if (looksLikePlanning(t)) return false;
  if (SYSTEM_ECHO.test(t) || TASK_ECHO.test(t) || SELF_REVISION.test(t) || SELF_TALK_PHRASE.test(t)) {
    return false;
  }
  if (
    /讲解失败|暂无讲解|暂无输出|思考过程|推理过程|只输出最终|自我检查|用户现在需要|要\s*2\s*[-~]?\s*3\s*句|每句结尾句号|不要别的/.test(
      t,
    )
  ) {
    return false;
  }
  if (/[？?]/.test(t)) return false;
  if (!isLikelyHoverTeachingClient(t)) return false;
  const n = (t.match(/[。！]/g) || []).length;
  if (n < 1 || n > 3) return false;
  // 与后端对齐：拒半截补句号 / 极短单句
  if (n === 1 && t.length < 18) return false;
  if (n === 1 && /(?:上限|能力|表现|组件|语法|过程)。$/.test(t) && t.length < 36) return false;
  if (/^第[一二三1-3]句/.test(t)) return false;
  const units = t.split(/(?<=[。！])/).map((x) => x.trim()).filter(Boolean);
  if (units.some((u) => isSelfTalkSentence(u) || looksTruncatedTeachingTail(u))) return false;
  return true;
}

function isComplete(s: string): boolean {
  return isSafeHoverDisplay(s);
}

export function hoverCacheKey(topic: string, style = 'professional'): string {
  return `${style}::${topic.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 400)}`;
}

export function readHoverCache(key: string): string | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    store.delete(key);
    return null;
  }
  // 脏缓存（思考/改稿）直接丢弃
  if (!isComplete(hit.text)) {
    store.delete(key);
    return null;
  }
  store.delete(key);
  store.set(key, { text: hit.text, at: Date.now() });
  return hit.text;
}

export function writeHoverCache(key: string, text: string) {
  if (!isComplete(text)) return;
  if (store.has(key)) store.delete(key);
  store.set(key, { text, at: Date.now() });
  while (store.size > MAX) {
    const first = store.keys().next().value;
    if (first) store.delete(first);
    else break;
  }
}

export function isCompleteHoverText(s: string): boolean {
  return isComplete(s);
}

export function looksLikeHoverPlanning(s: string): boolean {
  return looksLikePlanning(s);
}

/**
 * 展示用清洗：始终按句剥离旁白；禁止「看起来完整」就原样放行脏全文。
 */
export function sanitizeHoverDisplay(raw: string): string {
  const s = (raw || '').trim();
  if (!s) return '';
  // 先剥改稿 / 旁白
  const stripped = stripSelfRevisionClient(s);
  if (stripped && isSafeHoverDisplay(stripped)) return stripped.slice(0, 600);
  // 原文按句硬过滤
  const units = s
    .replace(/\s*[-•]\s+/g, '\n')
    .split(/(?<=[。！])|\n+/)
    .map((x) => x.trim().replace(/^[-*•]\s+/, ''))
    .filter((u) => u && !isSelfTalkSentence(u) && !looksTruncatedTeachingTail(u));
  const kept: string[] = [];
  for (const u of units) {
    const sent = /[。！]$/.test(u) ? u : `${u}。`;
    if (sent.length < 8) continue;
    if (isSelfTalkSentence(sent) || looksTruncatedTeachingTail(sent)) continue;
    kept.push(sent);
    if (kept.length >= 3) break;
  }
  const out = kept.join('');
  if (out && isSafeHoverDisplay(out)) return out.slice(0, 600);
  return '';
}
