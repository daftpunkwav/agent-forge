import { useEffect, useState } from 'react';

export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export function TableOfContents({ rootSelector = '.article-prose' }: { rootSelector?: string }) {
  const [items, setItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState('');

  useEffect(() => {
    const root = document.querySelector(rootSelector);
    if (!root) {
      setItems([]);
      return;
    }
    const headings = root.querySelectorAll('h2, h3');
    const list: TocItem[] = [];
    headings.forEach((h, i) => {
      if (!h.id) {
        h.id = `section-${i}-${(h.textContent || '')
          .trim()
          .toLowerCase()
          .replace(/[^\w\u4e00-\u9fff]+/g, '-')
          .slice(0, 40)}`;
      }
      list.push({
        id: h.id,
        text: (h.textContent || '').trim(),
        level: h.tagName === 'H3' ? 3 : 2,
      });
    });
    setItems(list);

    if (!list.length || !('IntersectionObserver' in window)) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) setActiveId(visible[0].target.id);
      },
      { rootMargin: '-80px 0px -55% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    headings.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [rootSelector]);

  if (!items.length) {
    return (
      <aside className="toc">
        <div className="toc-title">目录</div>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>此文章无目录</p>
      </aside>
    );
  }

  return (
    <aside className="toc">
      <div className="toc-title">目录</div>
      <ul className="toc-list">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              className={`toc-item${item.level === 3 ? ' toc-item-h3' : ''}${
                activeId === item.id ? ' active' : ''
              }`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(item.id);
                if (!el) return;
                const top = el.getBoundingClientRect().top + window.scrollY - 80;
                window.scrollTo({ top, behavior: 'smooth' });
                setActiveId(item.id);
              }}
            >
              {item.text}
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}
