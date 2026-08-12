import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DomainSummary } from '@core/contracts';
import { api } from '@/lib/api';
import { DomainSection } from '@/components/domain/DomainSection';

type ViewMode = 'grid' | 'list';

/**
 * Agent 知识 / 全站知识地图
 * 全局 grid|list 视图 + 领域内自动轮换
 */
export function KnowledgeOverviewPage() {
  const [track, setTrack] = useState<'agent' | 'llm' | 'all'>('agent');
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem('ui.domain-view');
    return s === 'list' ? 'list' : 'grid';
  });

  useEffect(() => {
    localStorage.setItem('ui.domain-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = track === 'all' ? undefined : track;
    api
      .listDomains(t)
      .then((r) => {
        if (!cancelled) setDomains(r.items);
      })
      .catch(() => {
        if (!cancelled) setDomains([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [track]);

  const chips = useMemo(
    () =>
      [
        { id: 'agent' as const, label: 'Agent 知识' },
        { id: 'llm' as const, label: 'LLM 基础' },
        { id: 'all' as const, label: '全部领域' },
      ] as const,
    [],
  );

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 700,
            fontSize: 'clamp(28px, 4vw, 40px)',
            margin: '0 0 8px',
          }}
        >
          知识地图
        </h1>
        <p style={{ margin: 0, color: 'var(--muted-foreground)', maxWidth: 640, lineHeight: 1.65, fontSize: 15 }}>
          以「赛道 → 领域 → 文章」扁平组织。支持网格 / 列表视图；领域内文章过多时自动轮换展示。
        </p>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          marginBottom: 24,
          position: 'sticky',
          top: 72,
          zIndex: 20,
          padding: '10px 0',
          background: 'color-mix(in srgb, var(--background) 92%, transparent)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              className="btn btn-sm"
              onClick={() => setTrack(c.id)}
              style={{
                background: track === c.id ? 'var(--primary)' : 'var(--card)',
                color: track === c.id ? 'var(--primary-foreground)' : 'var(--foreground)',
                border: '1px solid var(--border)',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div
          className="domain-view-toggle"
          role="group"
          aria-label="文章视图"
          style={{ marginLeft: 'auto' }}
        >
          {(['grid', 'list'] as ViewMode[]).map((m) => (
            <button
              key={m}
              type="button"
              className={`domain-view-btn${viewMode === m ? ' is-active' : ''}`}
              onClick={() => setViewMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
        <Link to="/search" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          高级筛选
        </Link>
      </div>

      {!loading && domains.length > 0 ? (
        <div
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            paddingBottom: 12,
            marginBottom: 20,
          }}
        >
          {domains.map((d) => (
            <a
              key={d.id}
              href={`#domain-${d.slug}`}
              className="btn btn-ghost btn-sm"
              style={{ textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0 }}
            >
              {d.name}
              <span style={{ opacity: 0.6, marginLeft: 4 }}>({d.articleCount ?? 0})</span>
            </a>
          ))}
        </div>
      ) : null}

      {loading ? (
        <p style={{ color: 'var(--muted-foreground)' }}>加载领域…</p>
      ) : domains.length === 0 ? (
        <div className="card">
          <p style={{ margin: 0 }}>暂无领域。管理员可在「领域管理」中添加。</p>
          <Link to="/admin/domains" style={{ fontSize: 14 }}>
            去管理 →
          </Link>
        </div>
      ) : (
        domains.map((d) => (
          <div key={d.id} id={`domain-${d.slug}`}>
            <DomainSection domain={d} viewMode={viewMode} />
          </div>
        ))
      )}
    </div>
  );
}
