import { useEffect, useState } from 'react';
import type { ArticleSummary } from '@core/contracts';
import { api } from '@/lib/api';
import { ArticleCardInlineAgent } from '@/components/article/ArticleCardInlineAgent';
import { HOME_FEED_LIMIT } from './homeDomains';

type Props = {
  title: string;
  eyebrow: string;
  sort: 'latest' | 'popular';
  excludeIds: string[];
  onIds: (ids: string[]) => void;
};

/** 首页热门/最新文章列 */
export function HomeFeedColumn({ title, eyebrow, sort, excludeIds, onIds }: Props) {
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const excludeKey = excludeIds.join(',');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listArticles({
        status: 'published',
        page: 1,
        pageSize: HOME_FEED_LIMIT,
        sort,
        exclude: excludeIds.length ? excludeIds : undefined,
      })
      .then((r) => {
        if (cancelled) return;
        const list = r.items.slice(0, HOME_FEED_LIMIT);
        setItems(list);
        onIds(list.map((x) => x.id));
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          onIds([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, excludeKey]);

  return (
    <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>{eyebrow}</div>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, margin: '0 0 16px' }}>{title}</h2>
      <div
        className="feed-col-list"
        style={{
          display: 'grid',
          gridTemplateRows: `repeat(${HOME_FEED_LIMIT}, minmax(152px, auto))`,
          gap: 12,
          flex: 1,
        }}
      >
        {loading && items.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card skeleton-card" style={{ minHeight: 152 }} />
            ))
          : items.length === 0
            ? <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>暂无文章</p>
            : items.map((a, i) => (
                <div
                  key={a.id}
                  style={{
                    animation: 'feed-in 0.45s ease both',
                    animationDelay: `${Math.min(i, 6) * 0.05}s`,
                    minHeight: 148,
                  }}
                >
                  <ArticleCardInlineAgent article={a} layout="feed" />
                </div>
              ))}
      </div>
    </section>
  );
}
