import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import type { ArticleSummary } from '@core/contracts';
import { Tag } from '@/components/ui/Tag';
import { ArticleCardInlineAgent } from '@/components/article/ArticleCardInlineAgent';
import { HomeHeroAnim } from '@/components/home/HomeHeroAnim';

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
  {
    title: '评测与安全',
    en: 'Eval & Safety',
    desc: '基准评测、红队测试与输出护栏',
    to: '/knowledge',
    tags: ['Eval', 'Guard'],
    color: 'var(--chart-4)',
  },
  {
    title: '记忆系统',
    en: 'Memory',
    desc: '短期上下文、长期记忆与检索增强',
    to: '/knowledge',
    tags: ['RAG', 'Memory'],
    color: 'var(--chart-2)',
  },
];

/** 知识领域：同时可见数量，其余自动轮播 */
const DOMAIN_VISIBLE = 4;
const DOMAIN_ROTATE_MS = 5200;

/** 热门 / 最新 各最多展示条数 */
const FEED_LIMIT = 10;

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
    <section style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div className="eyebrow" style={{ marginBottom: 10 }}>
        {eyebrow}
      </div>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, margin: '0 0 16px' }}>{title}</h2>
      <div
        className="feed-col-list"
        style={{
          display: 'grid',
          gridTemplateRows: `repeat(${FEED_LIMIT}, minmax(152px, auto))`,
          gap: 12,
          flex: 1,
        }}
      >
        {loading && items.length === 0
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="card skeleton-card" style={{ minHeight: 152 }} />
            ))
          : items.length === 0
            ? (
                <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>暂无文章</p>
              )
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

function DomainCarousel({ mode }: { mode: ViewMode }) {
  const [offset, setOffset] = useState(0);
  const [anim, setAnim] = useState(true);

  useEffect(() => {
    if (DOMAINS.length <= DOMAIN_VISIBLE) return;
    const id = window.setInterval(() => {
      setAnim(false);
      requestAnimationFrame(() => {
        setOffset((o) => (o + 1) % DOMAINS.length);
        setAnim(true);
      });
    }, DOMAIN_ROTATE_MS);
    return () => clearInterval(id);
  }, []);

  const visible = useMemo(() => {
    if (DOMAINS.length <= DOMAIN_VISIBLE) return DOMAINS;
    const list = [];
    for (let i = 0; i < DOMAIN_VISIBLE; i++) {
      list.push(DOMAINS[(offset + i) % DOMAINS.length]);
    }
    return list;
  }, [offset]);

  return (
    <div>
      <div
        key={offset}
        className={`home-domain-panel home-domain-panel--${mode}${anim ? ' domain-carousel-in' : ''}`}
      >
        {visible.map((d) => (
          <Link
            key={`${d.title}-${offset}`}
            to={d.to}
            className={`card card-hover domain-home-card domain-home-card--${mode}`}
            style={{ textDecoration: 'none' }}
          >
            <div>
              <div
                style={{
                  font: '700 10px/1 var(--font-mono)',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  color: d.color,
                  marginBottom: 2,
                }}
              >
                {d.title}
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted-foreground)', marginBottom: 4 }}>{d.en}</div>
              <h3
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 600,
                  fontSize: mode === 'list' ? 15 : 14,
                  margin: '0 0 4px',
                  lineHeight: 1.3,
                }}
              >
                {d.desc.split(' — ')[0]}
              </h3>
              <p
                style={{
                  margin: 0,
                  fontSize: 12,
                  color: 'var(--muted-foreground)',
                  lineHeight: 1.4,
                  display: '-webkit-box',
                  WebkitLineClamp: mode === 'list' ? 1 : 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {d.desc}
              </p>
              <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                {d.tags.slice(0, 3).map((t) => (
                  <Tag key={t}>{t}</Tag>
                ))}
              </div>
            </div>
            {mode === 'list' ? (
              <span style={{ color: 'var(--primary)', fontWeight: 600, fontSize: 13 }}>→</span>
            ) : null}
          </Link>
        ))}
      </div>
      {DOMAINS.length > DOMAIN_VISIBLE ? (
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 6,
            marginTop: 14,
          }}
        >
          {DOMAINS.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`领域组 ${i + 1}`}
              onClick={() => setOffset(i)}
              style={{
                width: i === offset ? 18 : 6,
                height: 6,
                borderRadius: 99,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                background:
                  i === offset
                    ? 'var(--primary)'
                    : 'color-mix(in srgb, var(--muted-foreground) 35%, transparent)',
                transition: 'width 0.25s ease, background 0.25s ease',
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function HomePage() {
  const [mode, setMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem('ui.view-mode');
    return s === 'list' ? 'list' : 'grid';
  });
  const [latestIds, setLatestIds] = useState<string[]>([]);

  useEffect(() => {
    localStorage.setItem('ui.view-mode', mode);
  }, [mode]);

  return (
    <div className="container" style={{ paddingBottom: 64 }}>
      {/* 顶行：文案与视觉交织，减少左右割裂 */}
      <section className="home-hero-grid">
        <div className="home-hero-copy">
          <div className="eyebrow" style={{ marginBottom: 16 }}>
            LEARN · BUILD · MASTER
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 600,
              letterSpacing: '-0.025em',
              fontSize: 'clamp(32px, 4vw, 48px)',
              lineHeight: 1.12,
              margin: 0,
              maxWidth: '34rem',
            }}
          >
            掌握 Agent 开发的
            <br />
            <span style={{ color: 'var(--primary)' }}>每一个核心概念</span>
          </h1>
          <p
            style={{
              marginTop: 16,
              maxWidth: '28rem',
              fontSize: 15,
              lineHeight: 1.65,
              color: 'var(--muted-foreground)',
            }}
          >
            从 ReAct 到 MCP，从 Prompt 工程到记忆系统——以可交互动画可视化抽象概念，系统化知识帮助你从零到一成为
            Agent 开发者。
          </p>
          <div style={{ marginTop: 24, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            <Link to="/knowledge" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>
              开始学习
            </Link>
            <Link to="/topics" className="btn btn-ghost btn-lg" style={{ textDecoration: 'none' }}>
              社区话题 →
            </Link>
          </div>
        </div>
        <div className="home-hero-visual">
          <HomeHeroAnim />
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
            marginBottom: 16,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>
              KNOWLEDGE MAP
            </div>
            <h2
              style={{
                fontFamily: 'var(--font-serif)',
                fontWeight: 600,
                fontSize: 'clamp(22px, 2.8vw, 30px)',
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

        <DomainCarousel mode={mode} />
      </section>

      {/* 左热门 · 右最新；卡片等高对齐；行内 Agent */}
      <section
        style={{
          marginTop: 48,
          display: 'grid',
          gap: 28,
          gridTemplateColumns: '1fr 1fr',
          alignItems: 'start',
        }}
        className="home-feed-grid"
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
        .domain-carousel-in {
          animation: domainCarIn 0.45s ease both;
        }
        @keyframes domainCarIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .home-domain-panel--grid {
          display: grid;
          gap: 12px;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }
        .home-domain-panel--list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .domain-home-card {
          padding: 12px 14px;
          min-height: 0;
          height: 100%;
          box-sizing: border-box;
        }
        .domain-home-card--list {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 12px;
          align-items: center;
        }
        .home-feed-grid .article-card-inline {
          width: 100%;
        }
        .feed-col-list {
          grid-template-rows: none !important;
          display: flex !important;
          flex-direction: column;
          gap: 12px;
        }
        .feed-col-list > div {
          min-height: 148px;
          /* 允许行内 Agent 展开后增高，不被裁切 */
          height: auto;
          overflow: visible;
        }
        @media (max-width: 1100px) {
          .home-domain-panel--grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }
        .home-hero-grid {
          position: relative;
          display: grid;
          grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
          gap: 8px 20px;
          align-items: center;
          padding: 40px 0 36px;
        }
        .home-hero-copy {
          position: relative;
          z-index: 2;
          padding-right: 8px;
        }
        .home-hero-visual {
          position: relative;
          z-index: 1;
          /* 向左叠入文案区，减弱「贴死右边」 */
          margin-left: -48px;
          margin-right: 0;
          justify-self: stretch;
          max-width: none;
        }
        .home-hero-visual .hero-flow {
          max-width: none;
          width: 100%;
        }
        @media (max-width: 900px) {
          .home-hero-grid {
            grid-template-columns: 1fr;
            gap: 20px;
          }
          .home-hero-visual {
            margin-left: 0;
            max-width: 520px;
          }
          .home-feed-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 560px) {
          .home-domain-panel--grid {
            grid-template-columns: 1fr;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .domain-carousel-in { animation: none !important; }
        }
      `}</style>
    </div>
  );
}
