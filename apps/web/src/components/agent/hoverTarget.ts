/**
 * 知识点悬停目标识别
 * - 仅知识路由 + 知识区
 * - 支持图表 SVG 节点（动画重绘后用稳定 key 续会话）
 * - 优先作者标注 / 词级 / 光标短语
 */

const SKIP_CLOSEST =
  '.agent-float, .agent-hover-tip, .agent-panel, header, footer, nav, .anim-controls, .anim-shell-header, .anim-btn';

export function isKnowledgeRoute(pathname: string): boolean {
  if (pathname === '/knowledge' || pathname.startsWith('/knowledge/')) return true;
  if (pathname === '/llm' || pathname.startsWith('/llm/')) return true;
  if (pathname.startsWith('/domains/')) return true;
  return false;
}

function inKnowledgeZone(el: Element): boolean {
  return Boolean(
    el.closest(
      [
        '[data-agent-zone="knowledge"]',
        '[data-article-body]',
        '.article-prose',
        '.article-content',
        'main article',
        '.viz-stage',
        '.anim-shell',
        '.anim-stage',
        'svg.viz-svg',
      ].join(', '),
    ),
  );
}

export interface HoverTargetInfo {
  el: HTMLElement;
  text: string;
  context: string;
  sectionId?: string;
  hint?: string;
  /** 稳定身份：跨动画重绘 / 同文案不同 DOM 仍视为同一目标 */
  stableKey: string;
}

function nearestHeading(el: Element): string {
  let cur: Element | null = el;
  while (cur) {
    let prev = cur.previousElementSibling;
    while (prev) {
      if (/^H[1-4]$/.test(prev.tagName)) {
        return (prev.textContent || '').trim().slice(0, 80);
      }
      prev = prev.previousElementSibling;
    }
    cur = cur.parentElement;
    if (!cur || cur.tagName === 'MAIN' || cur.id === 'root') break;
  }
  const shell = el.closest('.anim-shell');
  const header = shell?.querySelector('.anim-shell-header');
  if (header?.textContent) return header.textContent.trim().slice(0, 80);
  return '';
}

function asHtmlEl(el: Element | null): HTMLElement | null {
  if (!el) return null;
  if (el instanceof HTMLElement) return el;
  // SVGElement 也可挂 style / 高亮
  return (el.closest('g[data-agent-term], g[data-node-id], g') as HTMLElement | null) ||
    (el as unknown as HTMLElement);
}

function makeKey(parts: (string | undefined | null)[]): string {
  return parts
    .map((p) => (p || '').trim())
    .filter(Boolean)
    .join('|')
    .slice(0, 240);
}

/** SVG / 图表节点 */
function findVizTarget(from: Element): HoverTargetInfo | null {
  const marked = from.closest(
    '[data-agent-term], [data-agent-topic], [data-node-id]',
  ) as Element | null;

  if (marked && (marked.closest('.viz-stage, .anim-shell, .anim-stage, svg.viz-svg') || marked.closest('svg'))) {
    const nodeId = marked.getAttribute('data-node-id') || '';
    const term =
      marked.getAttribute('data-agent-term') ||
      marked.getAttribute('data-agent-text') ||
      marked.getAttribute('aria-label') ||
      (marked.querySelector?.('text') as SVGTextElement | null)?.textContent?.trim() ||
      (marked.textContent || '').trim();
    if (term && term.length >= 1) {
      const hint = marked.getAttribute('data-agent-hint') || undefined;
      const explain =
        marked.getAttribute('data-agent-text') || (hint ? `${term}：${hint}` : term);
      const el = asHtmlEl(marked) || (from as HTMLElement);
      const ctx = nearestHeading(marked);
      return {
        el,
        text: explain.slice(0, 800),
        context: ctx,
        hint,
        stableKey: makeKey(['viz', nodeId, term.slice(0, 80), ctx.slice(0, 40)]),
      };
    }
  }

  // 点到 circle/text 时向上找 g
  const g = from.closest('g[data-agent-term], g[data-node-id]') as SVGGElement | null;
  if (g) {
    const term =
      g.getAttribute('data-agent-term') ||
      g.getAttribute('data-agent-text') ||
      g.querySelector('text')?.textContent?.trim() ||
      '';
    if (term) {
      const el = g as unknown as HTMLElement;
      const ctx = nearestHeading(g);
      const nodeId = g.getAttribute('data-node-id') || '';
      return {
        el,
        text: (g.getAttribute('data-agent-text') || term).slice(0, 800),
        context: ctx,
        hint: g.getAttribute('data-agent-hint') || undefined,
        stableKey: makeKey(['viz', nodeId, term.slice(0, 80), ctx.slice(0, 40)]),
      };
    }
  }

  // 直接 text 标签
  if (from.tagName === 'text' || from.tagName === 'tspan') {
    const t = (from.textContent || '').trim();
    if (t.length >= 1 && t.length <= 40 && inKnowledgeZone(from)) {
      const el = asHtmlEl(from)!;
      const ctx = nearestHeading(from);
      return {
        el,
        text: t,
        context: ctx,
        stableKey: makeKey(['svgtext', t, ctx.slice(0, 40)]),
      };
    }
  }

  return null;
}

/**
 * 图表命中强化：animation 重绘/透明 label 时，用 elementsFromPoint 找带 data-agent 的节点
 */
function findVizAtPoint(clientX: number, clientY: number): HoverTargetInfo | null {
  if (typeof document.elementsFromPoint !== 'function') return null;
  const stack = document.elementsFromPoint(clientX, clientY);
  for (const el of stack) {
    if (!(el instanceof Element)) continue;
    if (el.closest(SKIP_CLOSEST)) continue;
    if (!el.closest('.viz-stage, .anim-shell, .anim-stage, svg.viz-svg')) continue;
    const hit = findVizTarget(el);
    if (hit) return hit;
  }
  return null;
}

function phraseAtPoint(clientX: number, clientY: number): HoverTargetInfo | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };

  let node: Node | null = null;
  let offset = 0;

  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(clientX, clientY);
    if (!range) return null;
    node = range.startContainer;
    offset = range.startOffset;
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(clientX, clientY);
    if (!pos) return null;
    node = pos.offsetNode;
    offset = pos.offset;
  } else return null;

  if (!node || node.nodeType !== Node.TEXT_NODE) return null;
  const textNode = node as Text;
  const parent = textNode.parentElement;
  if (!parent || !inKnowledgeZone(parent)) return null;
  if (parent.closest(SKIP_CLOSEST)) return null;
  // 图表文字已由 viz 路径处理
  if (parent.closest('svg.viz-svg, .viz-stage')) return null;

  const full = textNode.textContent || '';
  if (!full.trim()) return null;

  const hard = /[。！？；\n\r\.!\?;]/;
  const soft = /[，、,\s]/;
  let L = Math.max(0, Math.min(offset, full.length));
  let R = L;
  while (L > 0 && !hard.test(full[L - 1])) {
    if (soft.test(full[L - 1]) && offset - L > 4) break;
    L--;
    if (offset - L > 40) break;
  }
  while (R < full.length && !hard.test(full[R])) {
    if (soft.test(full[R]) && R - offset > 4) break;
    R++;
    if (R - L > 48) break;
  }
  let phrase = full.slice(L, R).trim().replace(/^[，、,\s]+|[，、,\s]+$/g, '');
  if (phrase.length > 36) {
    const mid = offset - L;
    phrase = phrase.slice(Math.max(0, mid - 12), Math.min(phrase.length, mid + 12)).trim();
  }
  if (phrase.length < 2) return null;
  const ctx = nearestHeading(parent);
  return {
    el: parent,
    text: phrase,
    context: ctx,
    sectionId: parent.closest('[id]')?.id,
    stableKey: makeKey(['phrase', phrase, ctx.slice(0, 40), parent.closest('[id]')?.id]),
  };
}

export function findHoverTarget(
  from: EventTarget | null,
  clientX?: number,
  clientY?: number,
): HoverTargetInfo | null {
  if (!(from instanceof Element)) return null;
  if (from.closest(SKIP_CLOSEST)) return null;

  // 图表优先
  if (from.closest('.viz-stage, .anim-shell, .anim-stage, svg.viz-svg')) {
    const viz = findVizTarget(from);
    if (viz) return viz;
    if (typeof clientX === 'number' && typeof clientY === 'number') {
      const atPoint = findVizAtPoint(clientX, clientY);
      if (atPoint) return atPoint;
    }
  }

  // 点在图表空白但坐标落在节点上时
  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const atPoint = findVizAtPoint(clientX, clientY);
    if (atPoint) return atPoint;
  }

  if (!inKnowledgeZone(from)) return null;

  // 作者标注（小块）
  const marked = from.closest('[data-agent-topic], [data-agent-term]') as HTMLElement | null;
  if (marked && inKnowledgeZone(marked)) {
    const raw =
      marked.getAttribute('data-agent-text') ||
      marked.getAttribute('data-agent-term') ||
      (marked.textContent || '').trim();
    const isTiny =
      marked.classList.contains('agent-term') ||
      marked.hasAttribute('data-agent-term') ||
      marked.tagName === 'IMG' ||
      (raw.length > 0 && raw.length <= 200 && marked.children.length <= 3);
    if (isTiny && raw.length >= 2) {
      const display = (marked.getAttribute('data-agent-term') || marked.textContent || raw).trim();
      const hint = marked.getAttribute('data-agent-hint') || undefined;
      const explainText = hint
        ? `${display}：${hint}`
        : marked.getAttribute('data-agent-text') || display;
      const ctx = nearestHeading(marked);
      return {
        el: marked,
        text: explainText.slice(0, 800),
        context: ctx,
        sectionId: marked.id || undefined,
        hint,
        stableKey: makeKey(['term', display.slice(0, 80), hint, marked.id, ctx.slice(0, 40)]),
      };
    }
  }

  const inline = from.closest('strong, em, mark, code') as HTMLElement | null;
  if (inline && inKnowledgeZone(inline)) {
    const t = (inline.textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && t.length <= 80) {
      const ctx = nearestHeading(inline);
      return {
        el: inline,
        text: t,
        context: ctx,
        sectionId: inline.closest('[id]')?.id,
        stableKey: makeKey(['inline', t, ctx.slice(0, 40), inline.closest('[id]')?.id]),
      };
    }
  }

  if (typeof clientX === 'number' && typeof clientY === 'number') {
    const phrase = phraseAtPoint(clientX, clientY);
    if (phrase) return phrase;
  }

  const cell = from.closest('li, td, th') as HTMLElement | null;
  if (cell && inKnowledgeZone(cell)) {
    const t = (cell.textContent || '').trim().replace(/\s+/g, ' ');
    if (t.length >= 2 && t.length <= 60) {
      const ctx = nearestHeading(cell);
      return {
        el: cell,
        text: t,
        context: ctx,
        sectionId: cell.closest('[id]')?.id,
        stableKey: makeKey(['cell', t.slice(0, 60), ctx.slice(0, 40)]),
      };
    }
  }

  return null;
}

export function highlightTarget(el: Element | null, on: boolean) {
  if (!el) return;
  const htmlEl = el as HTMLElement & SVGElement;
  if (on) {
    el.setAttribute('data-agent-active', '1');
    try {
      if ('style' in htmlEl && htmlEl.style) {
        (htmlEl as HTMLElement).style.outline =
          '2px solid color-mix(in srgb, var(--primary) 55%, transparent)';
        (htmlEl as HTMLElement).style.outlineOffset = '2px';
      }
    } catch {
      /* SVG 部分环境不支持 outline，忽略 */
    }
  } else {
    el.removeAttribute('data-agent-active');
    try {
      if ('style' in htmlEl && htmlEl.style) {
        (htmlEl as HTMLElement).style.outline = '';
        (htmlEl as HTMLElement).style.outlineOffset = '';
      }
    } catch {
      /* ignore */
    }
  }
}
