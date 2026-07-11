import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ArticleSummary, AnimationDef } from '@agentforge/shared';
import { Tag } from '@/components/ui/Tag';
import { useAuth } from '@/hooks/useAuth';
import { ANIMATION_TEMPLATES } from '@agentforge/shared';

export function AuthorDashboard() {
  const { isAuthor, isAdmin, loading: authLoading } = useAuth();
  const [articles, setArticles] = useState<ArticleSummary[]>([]);
  const [animations, setAnimations] = useState<AnimationDef[]>([]);
  const [filter, setFilter] = useState<'all' | 'published' | 'draft'>('all');

  useEffect(() => {
    if (!isAuthor) return;
    api.listArticles({ mine: true }).then((r) => setArticles(r.items)).catch(() => setArticles([]));
    api.listAnimations(true).then((r) => setAnimations(r.items)).catch(() => setAnimations([]));
  }, [isAuthor]);

  if (authLoading) return <div className="container" style={{ padding: 64 }}>加载中…</div>;
  if (!isAuthor) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>需要作者权限</h2>
        <Link to="/author/apply" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          申请成为作者
        </Link>
      </div>
    );
  }

  const filtered = articles.filter((a) => {
    if (filter === 'all') return true;
    return a.status === filter;
  });
  const published = articles.filter((a) => a.status === 'published').length;
  const drafts = articles.filter((a) => a.status === 'draft').length;
  const views = articles.reduce((s, a) => s + a.viewCount, 0);

  return (
    <div className="container" style={{ padding: '48px 24px 80px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 16, marginBottom: 32 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12 }}>
            AUTHOR DASHBOARD
          </div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 'clamp(28px, 3.5vw, 40px)', margin: 0 }}>
            作者工作台
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link to="/author/articles/new" className="btn btn-primary" style={{ textDecoration: 'none' }}>
            + 新建文章
          </Link>
          <Link to="/author/animations/new" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
            + 新建动画
          </Link>
          {isAdmin && (
            <Link to="/author/applications" className="btn btn-ghost" style={{ textDecoration: 'none' }}>
              审批申请
            </Link>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
          gap: 14,
          marginBottom: 40,
        }}
      >
        {[
          { label: '已发布', value: published, color: 'var(--primary)' },
          { label: '草稿', value: drafts, color: 'var(--chart-5)' },
          { label: '总阅读量', value: views, color: 'var(--chart-2)' },
          { label: '动画数量', value: animations.length, color: 'var(--chart-3)' },
        ].map((s) => (
          <div key={s.label} className="card">
            <div style={{ font: `700 24px/1 var(--font-mono)`, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, color: 'var(--muted-foreground)', marginTop: 6 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <section style={{ marginBottom: 48 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, margin: 0 }}>我的文章</h2>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['all', 'published', 'draft'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setFilter(f)}
                style={{
                  borderColor: filter === f ? 'var(--primary)' : undefined,
                  color: filter === f ? 'var(--foreground)' : undefined,
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <p style={{ color: 'var(--muted-foreground)' }}>暂无文章。点击上方新建第一篇。</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {filtered.map((a) => (
              <Link
                key={a.id}
                to={`/author/articles/${a.id}/edit`}
                className="card card-hover"
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                  <Tag variant={a.status === 'published' ? 'primary' : 'muted'}>{a.status}</Tag>
                  <Tag>{a.category}</Tag>
                </div>
                <div style={{ fontWeight: 600 }}>{a.title}</div>
                <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                  /{a.slug} · {a.viewCount} 阅读
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 22, marginBottom: 16 }}>动画库</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {animations.map((a) => (
            <Link
              key={a.id}
              to={`/author/animations/${a.id}/edit`}
              className="card card-hover"
              style={{ textDecoration: 'none' }}
            >
              <div style={{ font: '700 11px/1 var(--font-mono)', color: 'var(--chart-1)', marginBottom: 8 }}>
                {a.template}
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{a.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>
                {a.steps.length} 步
              </div>
            </Link>
          ))}
          {ANIMATION_TEMPLATES.map((t) => (
            <Link
              key={t.id}
              to={`/author/animations/new?template=${t.id}`}
              className="card card-hover"
              style={{ textDecoration: 'none', opacity: 0.85 }}
            >
              <div style={{ font: '700 11px/1 var(--font-mono)', color: 'var(--muted-foreground)', marginBottom: 8 }}>
                模板
              </div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{t.label}</div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>{t.desc}</div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
