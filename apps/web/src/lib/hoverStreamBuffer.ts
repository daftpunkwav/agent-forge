/**
 * hover 流式增量缓冲（C-10：AgentFloat 与 ArticleCardInlineAgent 共用）
 * 职责：追加 delta → 旁白/规则检测 → 按句截断为可展示前缀。
 * 与后端 soft-stream 双层门控配合，作为前端最后一层展示防线。
 */
import { isSafeHoverDisplay, looksLikeHoverPlanning } from './hoverExplainCache';

export function createHoverStreamAccumulator() {
  let buf = '';
  return {
    /**
     * 追加增量；返回可展示的安全前缀。
     * 未成句 / 命中旁白时返回 null（不清空缓冲，等后续洁净句）。
     */
    onDelta(text: string, replace = false): { show: string | null } {
      if (replace) buf = text;
      else buf += text;
      const partial = buf.trim();
      // 旁白/规则：不展示（不清空缓冲，自伤）
      if (looksLikeHoverPlanning(partial) && !isSafeHoverDisplay(partial)) {
        return { show: null };
      }
      // 未成句前缀：只展示到最后一个 。！（不用？——改稿自问）
      let show = '';
      if (isSafeHoverDisplay(partial) && /[。！]$/.test(partial)) {
        show = partial;
      } else {
        const lastEnd = Math.max(partial.lastIndexOf('。'), partial.lastIndexOf('！'));
        if (lastEnd >= 8) {
          const upto = partial.slice(0, lastEnd + 1);
          if (isSafeHoverDisplay(upto)) show = upto;
        }
      }
      return show ? { show } : { show: null };
    },
    /** 当前完整缓冲（仅用于 final 缺失时的兜底清洗，不作展示原文） */
    get(): string {
      return buf;
    },
    reset() {
      buf = '';
    },
  };
}
