import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { ArticleSummary, DomainSummary } from '@core/contracts';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Input';
import { ArticleCardInlineAgent } from '@/components/article/ArticleCardInlineAgent';

export function DomainDetailPage() {
  const { slug = '' } = useParams();
  const [sp, setSp] = useSearchParams();
  const page = Math.max(1, parseInt(sp.get('page') || '1', 10) || 1);
  const q = sp.get('q') || '';
  const level = sp.get('level') || '';
  const sort = sp.get('sort') || 'newest';

  const [domain, setDomain] = useState<DomainSummary | null>(null);
  const [items, setItems] = useState<ArticleSummary[]>([]);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState('');
  const [qInput, setQInput] = useState(q);

  useEffect(() => {
    setQInput(q);
  }, [q]);

  useEffect(() => {
    let cancelled = false;
    api
      .getDomain(slug, { page, pageSize: 8, q: q || undefined, level: level || undefined, sort })
      .then((r) => {
        if (cancelled) return;
        setDomain(r.domain);
        setItems(r.items);
        setTotalPages(r.totalPages);
        setTotal(r.total);
        setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      });
    return () => {
      cancelled = true;
    };
  }, [slug, page, q, level, sort]);

  function patchParams(patch: Record<string, string | null>) {
    const next = new URLSearchParams(sp);
    Object.entries(patch).forEach(([k, v]) => {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    });
    setSp(next);
  }

  if (error) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>{error}</h2>
        <Link to="/knowledge">返回知识地图</Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px' }}>
      <Link to={domain?.track === 'llm' ? '/llm' : '/knowledge'} style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
        ← 返回
      </Link>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(28px, 4vw, 40px)', margin: '12px 0 8px' }}>
        {domain?.name || '领域'}
      </h1>
      <p style={{ color: 'var(--muted-foreground)', marginTop: 0, maxWidth: 640 }}>{domain?.description}</p>

      <div
        className="card"
        style={{
          margin: '24px 0',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <Field label="搜索">
          <Input
            value={qInput}
            onChange={(e) => setQInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') patchParams({ q: qInput, page: '1' });
            }}
            placeholder="标题 / 摘要 / 标签"
          />
        </Field>
        <Field label="难度">
          <Select
            value={level}
            onChange={(e) => patchParams({ level: e.target.value || null, page: '1' })}
          >
            <option value="">全部</option>
            <option value="入门">入门</option>
            <option value="中级">中级</option>
            <option value="高级">高级</option>
          </Select>
        </Field>
        <Field label="排序">
          <Select value={sort} onChange={(e) => patchParams({ sort: e.target.value, page: '1' })}>
            <option value="newest">最新</option>
            <option value="popular">最热</option>
            <option value="title">标题</option>
          </Select>
        </Field>
        <Button onClick={() => patchParams({ q: qInput, page: '1' })}>应用</Button>
      </div>

      <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 12 }}>
        共 {total} 篇 · 每页 8 篇 · 第 {page}/{totalPages} 页
      </div>

      <div
        className="domain-slide-in"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 12,
        }}
      >
        {items.map((a) => (
          <ArticleCardInlineAgent
            key={a.id}
            article={a}
            layout="grid"
            to={domain?.track === 'llm' ? `/llm/${a.slug}` : `/knowledge/${a.slug}`}
          />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 28 }}>
        <Button
          variant="ghost"
          disabled={page <= 1}
          onClick={() => patchParams({ page: String(page - 1) })}
        >
          上一页
        </Button>
        <Button
          variant="ghost"
          disabled={page >= totalPages}
          onClick={() => patchParams({ page: String(page + 1) })}
        >
          下一页
        </Button>
      </div>

      <style>{`
        @media (max-width: 1100px) {
          .container > div[style*="repeat(4"] { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        .domain-slide-in { animation: domainIn 0.35s ease both; }
        @keyframes domainIn {
          from { opacity: 0; transform: translateY(14px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
