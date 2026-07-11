import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DomainSummary } from '@agentforge/shared';
import { api } from '@/lib/api';
import { DomainSection } from '@/components/domain/DomainSection';

export function LlmOverviewPage() {
  const [domains, setDomains] = useState<DomainSummary[]>([]);

  useEffect(() => {
    api.listDomains('llm').then((r) => setDomains(r.items)).catch(() => setDomains([]));
  }, []);

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(28px, 4vw, 44px)', marginBottom: 12 }}>
        LLM 基础
      </h1>
      <p style={{ color: 'var(--muted-foreground)', maxWidth: 600, marginBottom: 28, lineHeight: 1.7 }}>
        理解大语言模型是设计可靠 Agent 的前提。按领域浏览，每页 8 篇，可筛选检索。
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 28 }}>
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
        <Link to="/search?domain=llm-foundations" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
          搜索
        </Link>
      </div>
      {domains.map((d) => (
        <div key={d.id} id={`domain-${d.slug}`}>
          <DomainSection domain={d} />
        </div>
      ))}
      {!domains.length ? (
        <p style={{ color: 'var(--muted-foreground)' }}>暂无 LLM 领域，请管理员添加。</p>
      ) : null}
    </div>
  );
}
