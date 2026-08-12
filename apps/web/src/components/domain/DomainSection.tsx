import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary, DomainSummary } from '@core/contracts';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { ArticleCardInlineAgent, type ArticleCardLayout } from '@/components/article/ArticleCardInlineAgent';

const PAGE_SIZE_GRID = 8;
const PAGE_SIZE_LIST = 6;
const AUTO_ROTATE_MS = 8000;

type ViewMode = 'grid' | 'list';

/**
 * 领域文章区：
 * - grid / list 双视图
 * - 分页 + 自动轮换（文章多时）
 * - 行内悬停 Agent
 */
export function DomainSection({
  domain,
  viewMode: viewModeProp,
}: {
  domain: DomainSummary;
  /** 外部统一控制视图；不传则本区块自带切换 */
  viewMode?: ViewMode;
}) {
  const [localMode, setLocalMode] = useState<ViewMode>('grid');
  const mode = viewModeProp ?? localMode;
  const pageSize = mode === 'list' ? PAGE_SIZE_LIST : PAGE_SIZE_GRID;

  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState<'in' | 'next' | 'prev'>('in');
  const [autoPlay, setAutoPlay] = useState(true);
  const hoverPause = useRef(false);

  useEffect(() => {
    setPage(1);
  }, [domain.slug, mode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDomain(domain.slug, { page, pageSize })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotalPages(Math.max(1, r.totalPages));
        setTotal(r.total);
      })
      .catch(() => {
        if (!cancelled) {
          setItems([]);
          setTotalPages(1);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [domain.slug, page, pageSize]);

  // 多页时自动轮换
  useEffect(() => {
    if (!autoPlay || totalPages <= 1) return;
    const id = window.setInterval(() => {
      if (hoverPause.current) return;
      setSlide('next');
      setPage((p) => (p >= totalPages ? 1 : p + 1));
      window.setTimeout(() => setSlide('in'), 30);
    }, AUTO_ROTATE_MS);
    return () => clearInterval(id);
  }, [autoPlay, totalPages]);

  function go(next: number, dir: 'next' | 'prev') {
    if (next < 1 || next > totalPages || next === page) return;
    setAutoPlay(false);
    setSlide(dir);
    requestAnimationFrame(() => {
      setPage(next);
      window.setTimeout(() => setSlide('in'), 30);
    });
  }

  const layout: ArticleCardLayout = mode === 'list' ? 'list' : 'grid';
  const linkOf = (a: ArticleSummary) =>
    a.category === 'LLM基础' || domain.track === 'llm' ? `/llm/${a.slug}` : `/knowledge/${a.slug}`;

  return (
    <section
      className="domain-section"
      data-agent-zone="knowledge"
      style={{ marginBottom: 40 }}
      onMouseEnter={() => {
        hoverPause.current = true;
      }}
      onMouseLeave={() => {
        hoverPause.current = false;
      }}
    >
      <div className="domain-section-head">
        <div>
          <div className="domain-section-eyebrow" style={{ color: domain.color || 'var(--chart-1)' }}>
            {domain.track === 'llm' ? 'LLM' : 'AGENT'} · {domain.slug}
          </div>
          <h2 className="domain-section-title">{domain.name}</h2>
          <p className="domain-section-desc">{domain.description}</p>
        </div>
        <div className="domain-section-tools">
          <span className="domain-section-meta">
            {total} 篇 · {page}/{totalPages}
            {totalPages > 1 && autoPlay ? ' · 自动轮换' : ''}
          </span>
          {viewModeProp == null ? (
            <div className="domain-view-toggle" role="group" aria-label="视图">
              {(['grid', 'list'] as ViewMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`domain-view-btn${mode === m ? ' is-active' : ''}`}
                  onClick={() => setLocalMode(m)}
                >
                  {m}
                </button>
              ))}
            </div>
          ) : null}
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => go(page - 1, 'prev')}>
            ‹
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => go(page + 1, 'next')}
          >
            ›
          </Button>
          {totalPages > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setAutoPlay((v) => !v)}
              title={autoPlay ? '暂停轮换' : '开启轮换'}
            >
              {autoPlay ? '❚❚' : '▶'}
            </Button>
          ) : null}
          <Link to={`/domains/${domain.slug}`} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
            全部
          </Link>
        </div>
      </div>

      <div
        key={`${domain.slug}-${page}-${mode}`}
        className={`domain-articles domain-articles--${mode} domain-slide-${slide}`}
      >
        {loading
          ? Array.from({ length: mode === 'list' ? 3 : 4 }).map((_, i) => (
              <div key={i} className="card domain-skel" />
            ))
          : items.map((a) => (
              <ArticleCardInlineAgent key={a.id} article={a} layout={layout} to={linkOf(a)} />
            ))}
      </div>

      {!loading && items.length === 0 ? (
        <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>该领域暂无已发布文章</p>
      ) : null}

      {totalPages > 1 ? (
        <div className="domain-dots" role="tablist" aria-label="分页">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              type="button"
              className={`domain-dot${page === i + 1 ? ' is-active' : ''}`}
              aria-label={`第 ${i + 1} 页`}
              onClick={() => go(i + 1, i + 1 > page ? 'next' : 'prev')}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}
