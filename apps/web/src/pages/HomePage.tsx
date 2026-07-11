import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ArticleSummary } from '@agentforge/shared';
import { Tag } from '@/components/ui/Tag';

type ViewMode = 'grid' | 'list';

const DOMAINS = [
  {
    title: '推理模式',
    en: 'Reasoning Patterns',
    desc: 'ReAct · CoT · GoT · ToT — 理解 Agent 如何思考与行动',
    to: '/knowledge',
    tags: ['ReAct', 'CoT', 'GoT', 'ToT'],
    color: 'var(--chart-1)',
  },
  {
    title: '框架',
    en: 'Frameworks',
    desc: 'LangChain · AutoGen · CrewAI 架构与适用场景',
    to: '/knowledge',
    tags: ['LangChain', 'AutoGen', 'CrewAI'],
    color: 'var(--chart-2)',
  },
  {
    title: '协议与工程',
    en: 'Protocol & Engineering',
    desc: 'MCP、Context、Loop、Harness、Memory、评估与工具调用',
    to: '/knowledge',
    tags: ['MCP', 'Loop', 'Harness'],
    color: 'var(--chart-3)',
  },
  {
    title: 'LLM 基础',
    en: 'Foundations',
    desc: 'Transformer、分词、微调与 Prompting',
    to: '/llm',
    tags: ['Transformer', 'Token'],
    color: 'var(--chart-5)',
  },
];

/** 热门 / 最新 各最多展示条数（无无限滚动） */
const FEED_LIMIT = 10;

function ArticleFeedCard({ a, agentIntro }: { a: ArticleSummary; agentIntro?: boolean }) {
  const intro = agentIntro
    ? `「${a.title}」· ${a.level} · ${a.readMinutes} 分钟。${(a.summary || '').slice(0, 80)}`
    : a.summary;

  return (
    <Link
      to={`/knowledge/${a.slug}`}
      className="card card-hover article-feed-card"
      data-agent-zone="knowledge"
      data-agent-term={a.title}
      data-agent-text={intro}
      data-agent-topic
      data-agent-hint={a.summary?.slice(0, 100)}
      style={{ textDecoration: 'none', display: 'block', opacity: 0, animation: 'feed-in 0.45s ease forwards' }}
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <Tag variant="primary">{a.category}</Tag>
        <Tag>{a.level}</Tag>
        <Tag>{a.readMinutes} min</Tag>
        {typeof a.viewCount === 'number' && a.viewCount > 0 ? <Tag>{a.viewCount} 阅</Tag> : null}
      </div>
      <div style={{ fontFamily: 'var(--font-serif)', fontSize: 17, fontWeight: 600 }}>{a.title}</div>
      <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.55 }}>
        {intro}
      </p>
    </Link>
  );
}

function FeedColumn({
  title,
  eyebrow,
  sort,
  excludeIds,
  onIds,
}: {
  title: string;
  eyebrow: string;
  sort: 'latest' | 'popular';
  excludeIds: string[];
  onIds: (ids: string[]) => void;
}) {
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
        pageSize: FEED_LIMIT,
        sort,
        exclude: excludeIds.length ? excludeIds : undefined,
      })
      .then((r) => {
        if (cancelled) return;
        const list = r.items.slice(0, FEED_LIMIT);
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
    <section style={{ minWidth: 0 }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, margin: '0 0 16px' }}>{title}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {loading && items.length === 0 ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card skeleton-card" style={{ height: 110 }} />
          ))
        ) : items.length === 0 ? (
          <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>暂无文章</p>
        ) : (
          items.map((a, i) => (
            <div key={a.id} style={{ animationDelay: `${Math.min(i, 6) * 0.05}s` }}>
              <ArticleFeedCard a={a} agentIntro />
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function HomePage() {
  const [mode, setMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem('agentforge-view-mode');
    return s === 'list' ? 'list' : 'grid';
  });
  const [latestIds, setLatestIds] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem('agentforge-view-mode', mode);
  }, [mode]);

  const gridStyle = useMemo(
    () =>
      mode === 'grid'
        ? {
            display: 'grid',
            gap: 20,
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          }
        : {
            display: 'flex',
            flexDirection: 'column' as const,
            gap: 12,
          },
    [mode],
  );

  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      <section style={{ padding: '64px 0 40px' }}>
        <div className="eyebrow" style={{ marginBottom: 20 }}>
          LEARN · BUILD · MASTER
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            fontSize: 'clamp(34px, 4.2vw, 52px)',
            lineHeight: 1.1,
            margin: 0,
            maxWidth: 680,
          }}
        >
          掌握 Agent 开发的
          <br />
          <span style={{ color: 'var(--primary)' }}>每一个核心概念</span>
        </h1>
        <p
          style={{
            marginTop: 18,
            maxWidth: 520,
            fontSize: 16,
            lineHeight: 1.7,
            color: 'var(--muted-foreground)',
          }}
        >
          从 ReAct 到 MCP，从 Prompt 工程到记忆系统——以可交互动画可视化抽象概念，系统化知识帮助你从零到一成为
          Agent 开发者。
        </p>
        <div style={{ marginTop: 28, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Link to="/knowledge" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>
            开始学习
          </Link>
          <Link to="/topics" className="btn btn-ghost btn-lg" style={{ textDecoration: 'none' }}>
            社区话题 →
          </Link>
        </div>
      </section>

      <section>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 12 }}>
              KNOWLEDGE MAP
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 600,
                fontSize: 'clamp(24px, 3vw, 34px)',
                margin: 0,
              }}
            >
              知识领域
            </h2>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {(['grid', 'list'] as ViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className="btn btn-sm"
                onClick={() => setMode(m)}
                style={{
                  background: mode === m ? 'var(--card)' : 'transparent',
                  border: '1px solid var(--border)',
                  color: mode === m ? 'var(--foreground)' : 'var(--muted-foreground)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.05em',
                  textTransform: 'uppercase',
                  boxShadow: mode === m ? 'var(--shadow-xs)' : 'none',
                }}
              >
                {m}
              </button>
            ))}
          </div>
        </div>

        <div style={gridStyle}>
          {DOMAINS.map((d) => (
            <Link
              key={d.title}
              to={d.to}
              className="card card-hover"
              style={{
                textDecoration: 'none',
                display: mode === 'list' ? 'grid' : 'block',
                gridTemplateColumns: mode === 'list' ? '1fr auto' : undefined,
                gap: mode === 'list' ? 16 : undefined,
                alignItems: 'center',
              }}
            >
              <div>
                <div
                  style={{
                    font: '700 11px/1 var(--font-mono)',
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                    color: d.color,
                    marginBottom: 4,
                  }}
                >
                  {d.title}
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 8 }}>{d.en}</div>
                <h3
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontWeight: 600,
                    fontSize: mode === 'list' ? 18 : 17,
                    margin: '0 0 8px',
                  }}
                >
                  {d.desc.split(' — ')[0]}
                </h3>
                <p style={{ margin: 0, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.55 }}>
                  {d.desc}
                </p>
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {d.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </div>
              </div>
              {mode === 'list' ? (
                <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 14 }}>阅读 →</span>
              ) : null}
            </Link>
          ))}
        </div>
      </section>

      {/* 左热门 · 右最新；最新优先，热门排除最新已出现 */}
      <section
        style={{
          marginTop: 56,
          display: 'grid',
          gap: 32,
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        }}
      >
        <FeedColumn
          title="热门文章"
          eyebrow="POPULAR"
          sort="popular"
          excludeIds={latestIds}
          onIds={() => undefined}
        />
        <FeedColumn
          title="最新文章"
          eyebrow="LATEST"
          sort="latest"
          excludeIds={[]}
          onIds={setLatestIds}
        />
      </section>

      <style>{`
        @keyframes feed-in {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .skeleton-card {
          background: linear-gradient(90deg, var(--muted) 25%, var(--card) 50%, var(--muted) 75%);
          background-size: 200% 100%;
          animation: shimmer 1.2s ease infinite;
          border: 1px solid var(--border);
        }
        @keyframes shimmer {
          0% { background-position: 100% 0; }
          100% { background-position: -100% 0; }
        }
      `}</style>
    </div>
  );
}
