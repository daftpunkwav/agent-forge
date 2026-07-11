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

export function HomePage() {
  const [mode, setMode] = useState<ViewMode>(() => {
    const s = localStorage.getItem('agentforge-view-mode');
    return s === 'list' ? 'list' : 'grid';
  });
  const [articles, setArticles] = useState<ArticleSummary[]>([]);

  useEffect(() => {
    localStorage.setItem('agentforge-view-mode', mode);
  }, [mode]);

  useEffect(() => {
    api
      .listArticles({ status: 'published' })
      .then((r) => setArticles(r.items.slice(0, 6)))
      .catch(() => setArticles([]));
  }, []);

  const gridStyle = useMemo(
    () =>
      mode === 'grid'
        ? {
            display: 'grid',
            gap: 20,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
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
      <section style={{ padding: '72px 0 48px' }}>
        <div className="eyebrow" style={{ marginBottom: 20 }}>
          LEARN · BUILD · MASTER
        </div>
        <h1
          style={{
            fontFamily: 'var(--font-serif)',
            fontWeight: 600,
            letterSpacing: '-0.025em',
            fontSize: 'clamp(36px, 4.5vw, 56px)',
            lineHeight: 1.1,
            margin: 0,
            maxWidth: 720,
          }}
        >
          掌握 Agent 开发的
          <br />
          <span style={{ color: 'var(--primary)' }}>每一个核心概念</span>
        </h1>
        <p
          style={{
            marginTop: 20,
            maxWidth: 540,
            fontSize: 17,
            lineHeight: 1.7,
            color: 'var(--muted-foreground)',
          }}
        >
          从 ReAct 到 MCP，从 Prompt 工程到记忆系统——以可交互动画可视化抽象概念，系统化知识帮助你从零到一成为
          Agent 开发者。
        </p>
        <div style={{ marginTop: 32, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
          <Link to="/knowledge" className="btn btn-primary btn-lg" style={{ textDecoration: 'none' }}>
            开始学习
          </Link>
          <Link to="/knowledge/react" className="btn btn-ghost btn-lg" style={{ textDecoration: 'none' }}>
            查看 ReAct 动画 →
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
                fontSize: 'clamp(26px, 3vw, 36px)',
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

      {articles.length > 0 && (
        <section style={{ marginTop: 64 }}>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, marginBottom: 20 }}>最新文章</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {articles.map((a) => (
              <Link
                key={a.id}
                to={`/knowledge/${a.slug}`}
                className="card card-hover"
                style={{ textDecoration: 'none', display: 'block' }}
              >
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                  <Tag variant="primary">{a.category}</Tag>
                  <Tag>{a.level}</Tag>
                  <Tag>{a.readMinutes} min</Tag>
                </div>
                <div style={{ fontFamily: 'var(--font-serif)', fontSize: 18, fontWeight: 600 }}>{a.title}</div>
                <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--muted-foreground)' }}>{a.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
