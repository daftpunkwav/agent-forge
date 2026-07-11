/** 布局几何工具 */

export function pt(x: number, y: number, w: number, h: number, pad = 48) {
  return {
    x: pad + x * (w - pad * 2),
    y: pad + y * (h - pad * 2),
  };
}

export function ringPoint(cx: number, cy: number, r: number, angleRad: number) {
  return {
    x: cx + r * Math.cos(angleRad),
    y: cy + r * Math.sin(angleRad),
  };
}

/** 三次贝塞尔控制点（简单横向弯曲） */
export function curvePath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  curved = false,
): string {
  if (!curved) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const nx = -dy * 0.2;
  const ny = dx * 0.2;
  return `M ${x1} ${y1} Q ${mx + nx} ${my + ny} ${x2} ${y2}`;
}

/** 环上两节点之间的弧 */
export function arcPath(
  cx: number,
  cy: number,
  r: number,
  a0: number,
  a1: number,
): string {
  let delta = a1 - a0;
  while (delta <= 0) delta += Math.PI * 2;
  while (delta > Math.PI * 2) delta -= Math.PI * 2;
  const large = delta > Math.PI ? 1 : 0;
  const p0 = ringPoint(cx, cy, r, a0);
  const p1 = ringPoint(cx, cy, r, a1);
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${large} 1 ${p1.x} ${p1.y}`;
}

export function pointOnLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  t: number,
) {
  return { x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t };
}
