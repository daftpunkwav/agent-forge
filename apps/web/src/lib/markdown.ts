import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  gfm: true,
  breaks: true,
});

/**
 * 作者标注语法预处理：
 * - [[术语]] → 可悬停讲解
 * - [[术语|讲解提示]] → 悬停用提示作为 Agent 输入
 * - ![alt](url){agent="讲解"} 或 {agent=讲解} → 图片可悬停
 */
export function preprocessAgentMarkup(md: string): string {
  // 先按围栏代码块分段：代码块内的示例文本（如语法说明里的 [[术语]]）不做替换
  return md
    .split(/(```[\s\S]*?(?:```|$))/g)
    .map((seg) => (seg.startsWith('```') ? seg : replaceAgentMarkup(seg)))
    .join('');
}

/** 在单个非代码段内执行作者标注替换 */
function replaceAgentMarkup(md: string): string {
  let out = md;

  // 图片：![alt](url){agent="hint"} / {agent=hint}
  out = out.replace(
    /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)\{agent=(?:"([^"]*)"|'([^']*)'|([^\s}]+))\}/g,
    (_m, alt, url, title, h1, h2, h3) => {
      const hint = (h1 || h2 || h3 || alt || '').trim();
      const a = String(alt || '').replace(/"/g, '&quot;');
      const u = String(url || '').replace(/"/g, '&quot;');
      const t = title ? ` title="${String(title).replace(/"/g, '&quot;')}"` : '';
      const explain = (hint || a || '图片').replace(/"/g, '&quot;');
      return `<img src="${u}" alt="${a}"${t} class="agent-term-img" data-agent-topic data-agent-term="${a || '图片'}" data-agent-text="${explain}" data-agent-hint="${explain}" />`;
    },
  );

  // 术语：[[term|hint]] 或 [[term]]
  out = out.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, term, hint) => {
    const t = String(term).trim();
    if (!t) return _m;
    const h = hint != null ? String(hint).trim() : '';
    const display = escapeHtml(t);
    const explain = escapeHtml(h ? `${t}：${h}` : t);
    const hintAttr = h ? ` data-agent-hint="${escapeHtml(h)}"` : '';
    return `<span class="agent-term" data-agent-topic data-agent-term="${display}" data-agent-text="${explain}"${hintAttr}>${display}</span>`;
  });

  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 将 Markdown 转为消毒后的 HTML */
export function renderMarkdown(md: string): string {
  const pre = preprocessAgentMarkup(md);
  const raw = marked.parse(pre, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ADD_ATTR: [
      'id',
      'target',
      'rel',
      'class',
      'data-agent-topic',
      'data-agent-term',
      'data-agent-text',
      'data-agent-hint',
      'data-agent-zone',
    ],
  });
}

/**
 * 解析文章中的动画嵌入
 */
export function splitMarkdownWithAnimations(
  md: string,
): Array<{ type: 'md'; content: string } | { type: 'animation'; id: string }> {
  const parts: Array<{ type: 'md'; content: string } | { type: 'animation'; id: string }> = [];
  const re = /:::animation\{id=["']?([^"'\}\s]+)["']?\}\s*:::/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    if (m.index > last) {
      parts.push({ type: 'md', content: md.slice(last, m.index) });
    }
    parts.push({ type: 'animation', id: m[1] });
    last = m.index + m[0].length;
  }
  if (last < md.length) {
    parts.push({ type: 'md', content: md.slice(last) });
  }
  if (parts.length === 0) {
    parts.push({ type: 'md', content: md });
  }
  return parts;
}

/** 为 h2/h3 注入 id，便于 TOC；start 为起始序号，返回注入后的 html 与下一可用序号（跨片段保持 id 唯一） */
export function injectHeadingIds(html: string, start = 0): { html: string; next: number } {
  let i = start;
  const out = html.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (_full, level, attrs, inner) => {
    if (/\sid=/.test(attrs)) return _full;
    const text = inner.replace(/<[^>]+>/g, '').trim();
    const id =
      'section-' +
      i++ +
      '-' +
      text
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40);
    return `<h${level}${attrs} id="${id}">${inner}</h${level}>`;
  });
  return { html: out, next: i };
}
