import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArticleSummary, DomainSummary } from '@agentforge/shared';
import { api } from '@/lib/api';
import { Tag } from '@/components/ui/Tag';
import { Button } from '@/components/ui/Button';

/** 领域区块：最多 8 篇（2×4），带翻页 + 上下切换动画 */
export function DomainSection({ domain }: { domain: DomainSummary }) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState<'in' | 'up' | 'down'>('in');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDomain(domain.slug, { page, pageSize: 8 })
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotalPages(r.totalPages);
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
  }, [domain.slug, page]);

  function go(next: number, dir: 'up' | 'down') {
    if (next < 1 || next > totalPages || next === page) return;
    setSlide(dir);
    // 触发 CSS 动画：短暂切出再切入
    requestAnimationFrame(() => {
      setPage(next);
      setTimeout(() => setSlide('in'), 20);
    });
  }

  return (
    <section className="domain-section" data-agent-zone="knowledge" style={{ marginBottom: 48 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <div
            style={{
              font: '700 11px/1 var(--font-mono)',
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: domain.color || 'var(--chart-1)',
              marginBottom: 6,
            }}
          >
            {domain.track === 'llm' ? 'LLM' : 'AGENT'} · {domain.slug}
          </div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, margin: '0 0 6px' }}>
            {domain.name}
          </h2>
          <p style={{ margin: 0, fontSize: 14, color: 'var(--muted-foreground)', maxWidth: 560 }}>
            {domain.description}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
            {total} 篇 · 第 {page}/{totalPages} 页
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={page <= 1}
            onClick={() => go(page - 1, 'down')}
            aria-label="上一页"
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= totalPages}
            onClick={() => go(page + 1, 'up')}
            aria-label="下一页"
          >
            ↓
          </Button>
          <Link
            to={`/domains/${domain.slug}`}
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            查看全部
          </Link>
        </div>
      </div>

      <div
        key={`${domain.slug}-${page}`}
        className={`domain-grid domain-slide-${slide}`}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
          minHeight: 220,
        }}
      >
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card" style={{ minHeight: 120, opacity: 0.5 }} />
            ))
          : items.map((a) => (
              <Link
                key={a.id}
                to={`/knowledge/${a.slug}`}
                className="card card-hover"
                data-agent-zone="knowledge"
                data-agent-term
                data-agent-text={`${a.title}。${a.summary}`}
                style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', minHeight: 140 }}
              >
                <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                  <Tag>{a.level}</Tag>
                  <Tag variant="outline">{a.readMinutes}m</Tag>
                </div>
                <div
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontWeight: 600,
                    fontSize: 15,
                    lineHeight: 1.35,
                    marginBottom: 6,
                  }}
                >
                  {a.title}
                </div>
                <p
                  style={{
                    margin: 0,
                    fontSize: 12,
                    color: 'var(--muted-foreground)',
                    lineHeight: 1.5,
                    flex: 1,
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {a.summary}
                </p>
              </Link>
            ))}
      </div>

      {!loading && items.length === 0 ? (
        <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>该领域暂无已发布文章</p>
      ) : null}

      <style>{`
        @media (max-width: 1100px) {
          .domain-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 560px) {
          .domain-grid { grid-template-columns: 1fr !important; }
        }
        .domain-slide-in {
          animation: domainIn 0.35s ease both;
        }
        .domain-slide-up {
          animation: domainOutUp 0.2s ease both;
        }
        .domain-slide-down {
          animation: domainOutDown 0.2s ease both;
        }
        @keyframes domainIn {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes domainOutUp {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(-12px); }
        }
        @keyframes domainOutDown {
          from { opacity: 1; transform: translateY(0); }
          to { opacity: 0; transform: translateY(12px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .domain-slide-in, .domain-slide-up, .domain-slide-down { animation: none !important; }
        }
      `}</style>
    </section>
  );
}
