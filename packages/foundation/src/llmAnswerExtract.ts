/**
 * LLM 输出解析：从「思考草稿 + 正文」拆出用户可见答案。
 * 归属说明：被 services/llm(adapters)与 services/agent(tool-loop)共同消费的纯函数,
 * 收敛于 foundation 以消除跨服务源码依赖。
 */
import { isSystemEcho, looksLikeHoverPlanning } from '@core/contracts';

/**
 * 从「思考草稿 + 正文」中拆出用户可见答案。
 * StepFun 常把策划/内心独白/反复改稿放在 thinking；悬停绝不可展示。
 * A-04：统一出口处做 system 规则复述质检——正文复述规则视为无效（触发上层兜底），
 * 思考过程复述规则则打码不回传，避免把 prompt 内部措辞展示给用户。
 */
export function extractVisibleAnswer(thinking: string, text: string): { answer: string; thinking: string } {
  const r = extractVisibleAnswerInner(thinking, text);
  if (r.answer && isSystemEcho(r.answer)) {
    return { answer: '', thinking: r.thinking };
  }
  if (r.thinking && isSystemEcho(r.thinking)) {
    return { answer: r.answer, thinking: '' };
  }
  return r;
}

function extractVisibleAnswerInner(
  thinking: string,
  text: string,
): { answer: string; thinking: string } {
  const t = (text || '').trim();
  const th = (thinking || '').trim();

  // 正文已有结构标题：优先正文
  if (t && (/^#{1,3}\s*Thought/im.test(t) || t.length > 40)) {
    if (looksLikeHoverPlanning(t) && th) {
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
  if (th && !looksLikeHoverPlanning(th)) return { answer: th, thinking: '' };
  if (th) return { answer: '', thinking: th };
  return { answer: '', thinking: '' };
}

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
