/** 悬停气泡视口定位（纯函数，无 React 依赖） */

export function placeHoverTip(x: number, y: number, contentLen: number) {
  const maxW = Math.min(420, window.innerWidth - 24);
  const minW = Math.min(280, maxW);
  const estH = Math.min(360, Math.max(120, 80 + Math.ceil(contentLen / 40) * 18));
  let left = x + 12;
  let top = y + 12;
  if (left + maxW > window.innerWidth - 8) left = Math.max(8, x - maxW - 12);
  if (top + estH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - estH - 12);
  if (left < 8) left = 8;
  if (top < 8) top = 8;
  return { left, top, maxW, minW, maxH: Math.min(360, window.innerHeight - 24) };
}

/** 相对悬停目标元素计算锚定点（视口坐标） */
export function anchorHoverNearTarget(
  el: HTMLElement | null,
  pointerX: number,
  pointerY: number,
): { x: number; y: number } {
  if (el && el.isConnected) {
    const r = el.getBoundingClientRect();
    const x = r.left + Math.min(Math.max(r.width * 0.55, 24), Math.max(r.width - 4, 24));
    const y = r.bottom + 4;
    if (
      r.bottom < 0 ||
      r.top > window.innerHeight ||
      r.right < 0 ||
      r.left > window.innerWidth
    ) {
      return { x: pointerX, y: pointerY };
    }
    return { x, y };
  }
  return { x: pointerX, y: pointerY };
}
