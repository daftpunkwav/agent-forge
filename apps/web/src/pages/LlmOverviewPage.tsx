import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DomainSummary } from '@agentforge/shared';
import { api } from '@/lib/api';
import { DomainSection } from '@/components/domain/DomainSection';

type ViewMode = 'grid' | 'list';

export function LlmOverviewPage() {
  const [domains, setDomains] = useState<DomainSummary[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem('agentforge-domain-view');
    return s === 'list' ? 'list' : 'grid';
  });

  useEffect(() => {
    localStorage.setItem('agentforge-domain-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    let cancelled = false;
    api
      .listDomains('llm')
      .then((r) => {
        if (!cancelled) setDomains(r.items);
      })
      .catch(() => {
        if (!cancelled) setDomains([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 20,
        }}
      >
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(28px, 4vw, 40px)',
              margin: '0 0 8px',
            }}
          >
            LLM 基础
          </h1>
          <p style={{ color: 'var(--muted-foreground)', maxWidth: 560, margin: 0, lineHeight: 1.65, fontSize: 15 }}>
            理解大语言模型是设计可靠 Agent 的前提。支持网格 / 列表视图；文章过多时自动轮换。
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <div className="domain-view-toggle" role="group" aria-label="文章视图">
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
          <Link
            to="/search?domain=llm-foundations"
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            搜索
          </Link>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {domains.map((d) => (
          <Link
            key={d.id}
            to={`/domains/${d.slug}`}
            className="btn btn-ghost btn-sm"
            style={{ textDecoration: 'none' }}
          >
            {d.name}
          </Link>
        ))}
      </div>

      {domains.map((d) => (
        <div key={d.id} id={`domain-${d.slug}`}>
          <DomainSection domain={d} viewMode={viewMode} />
        </div>
      ))}
      {!domains.length ? (
        <p style={{ color: 'var(--muted-foreground)' }}>暂无 LLM 领域，请管理员添加。</p>
      ) : null}
    </div>
  );
}
