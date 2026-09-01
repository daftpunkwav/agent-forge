/**
 * 悬停讲解 UI 揭示辅助（卡片内联 / 页面气泡共用）
 */
import { isSafeHoverDisplay } from './hoverExplainCache';

/** 最短「思考中」展示后再揭晓 */
export function scheduleMinThinkReveal(opts: {
  minThinkMs: number;
  startedAt: number;
  onReveal: () => void;
  isStale?: () => boolean;
  timerRef?: { current: ReturnType<typeof setTimeout> | null };
}): void {
  const elapsed = Date.now() - opts.startedAt;
  const wait = Math.max(0, opts.minThinkMs - elapsed);
  const fire = () => {
    if (opts.isStale?.()) return;
    opts.onReveal();
  };
  if (wait <= 0) {
    fire();
    return;
  }
  if (opts.timerRef) {
    if (opts.timerRef.current) clearTimeout(opts.timerRef.current);
    opts.timerRef.current = setTimeout(() => {
      opts.timerRef!.current = null;
      fire();
    }, wait);
  } else {
    setTimeout(fire, wait);
  }
}

/** 流式片段：仅展示到完整句号且通过安全质检 */
export function pickSafeHoverSentence(partial: string, minChars = 8): string | null {
  if (!partial || !isSafeHoverDisplay(partial)) return null;
  let show = partial;
  if (!/[。！]$/.test(show)) {
    const lastEnd = Math.max(show.lastIndexOf('。'), show.lastIndexOf('！'));
    if (lastEnd < minChars) return null;
    show = show.slice(0, lastEnd + 1);
    if (!isSafeHoverDisplay(show)) return null;
  }
  return show;
}

/** 非安全文案兜底为失败提示 */
export function coerceHoverFailText(
  text: string,
  failPrefix = '讲解',
  failMessage = '讲解生成失败，请再悬停试一次',
): string {
  const safe = isSafeHoverDisplay(text) ? text : text.trim();
  return safe || (text.startsWith(failPrefix) ? text : failMessage);
}
