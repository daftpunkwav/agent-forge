import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, type FormEvent } from 'react';
import { ACCENTS, useTheme } from '@/hooks/useTheme';
import { useAuth } from '@/hooks/useAuth';
import { AgentFloat } from '@/components/agent/AgentFloat';

const nav = [
  { to: '/', label: '首页', end: true },
  { to: '/knowledge', label: 'Agent知识' },
  { to: '/llm', label: 'LLM基础' },
  { to: '/topics', label: '话题' },
  { to: '/news', label: '前沿资讯' },
];

export function AppShell() {
  const { theme, toggle, accent, setAccent } = useTheme();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accentOpen, setAccentOpen] = useState(false);
  const [q, setQ] = useState('');
  const navigate = useNavigate();

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const query = q.trim();
    navigate(query ? `/search?q=${encodeURIComponent(query)}` : '/search');
  }

  return (
    <>
      <header
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          height: 'var(--header-h)',
          background: 'color-mix(in srgb, var(--background) 88%, transparent)',
          borderBottom: '1px solid var(--border)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div
          className="container"
          style={{
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0 }}>
            <Link
              to="/"
              style={{
                fontFamily: 'var(--font-serif)',
                fontSize: '1.35rem',
                fontWeight: 700,
                letterSpacing: '-0.02em',
                textDecoration: 'none',
                color: 'var(--foreground)',
                flexShrink: 0,
              }}
            >
              AgentForge
            </Link>

            <nav className="desktop-nav" style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              {nav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  style={({ isActive }) => ({
                    padding: '8px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: 500,
                    textDecoration: 'none',
                    color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                    background: isActive ? 'var(--muted)' : 'transparent',
                  })}
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {/* 顶部搜索框 */}
            <form
              onSubmit={onSearch}
              className="header-search"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                minWidth: 200,
                maxWidth: 320,
              }}
            >
              <input
                className="input"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="搜索知识…"
                aria-label="搜索"
                style={{
                  minHeight: 34,
                  fontSize: 13,
                  borderRadius: 999,
                  padding: '0 14px',
                }}
              />
            </form>

            {/* 主题色 */}
            <div style={{ position: 'relative' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="主题色"
                title="主题色"
                onClick={() => setAccentOpen((v) => !v)}
                style={{ width: 36, padding: 0 }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 999,
                    background: 'var(--primary)',
                    display: 'inline-block',
                    boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--foreground) 15%, transparent)',
                  }}
                />
              </button>
              {accentOpen && (
                <div
                  className="card"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 40,
                    zIndex: 60,
                    padding: 10,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 8,
                    minWidth: 140,
                  }}
                >
                  {ACCENTS.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      title={a.label}
                      onClick={() => {
                        setAccent(a.id);
                        setAccentOpen(false);
                      }}
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 8,
                        border:
                          accent === a.id
                            ? '2px solid var(--foreground)'
                            : '1px solid var(--border)',
                        background: a.swatch,
                        cursor: 'pointer',
                        padding: 0,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* 深浅主题图标 */}
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={toggle}
              aria-label={theme === 'dark' ? '切换浅色' : '切换深色'}
              title={theme === 'dark' ? '浅色' : '深色'}
              style={{ width: 36, padding: 0, fontSize: 15 }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>

            {user ? (
              <Link to="/profile" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
                {user.name}
              </Link>
            ) : (
              <Link to="/login" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
                登录
              </Link>
            )}

            <button
              type="button"
              className="btn btn-ghost btn-sm mobile-only"
              aria-label="菜单"
              onClick={() => setMobileOpen((v) => !v)}
              style={{ display: 'none' }}
            >
              菜单
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div
            style={{
              borderTop: '1px solid var(--border)',
              background: 'var(--background)',
              padding: '12px 24px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}
          >
            {nav.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                style={{
                  padding: '10px 12px',
                  textDecoration: 'none',
                  color: 'var(--foreground)',
                  borderRadius: 8,
                }}
              >
                {item.label}
              </Link>
            ))}
            <Link
              to="/search"
              onClick={() => setMobileOpen(false)}
              style={{ padding: '10px 12px', textDecoration: 'none' }}
            >
              搜索
            </Link>
            {user && (
              <Link
                to="/profile"
                onClick={() => setMobileOpen(false)}
                style={{ padding: '10px 12px', textDecoration: 'none' }}
              >
                个人中心
              </Link>
            )}
          </div>
        )}
      </header>

      <main style={{ flex: 1, minHeight: '60vh' }}>
        <Outlet />
      </main>

      <footer
        style={{
          marginTop: 48,
          background: 'var(--muted)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <div
          className="container"
          style={{
            padding: '40px 28px 28px',
            display: 'grid',
            gap: 28,
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.4rem', fontWeight: 700 }}>
              AgentForge
            </div>
            <p style={{ marginTop: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>
              Agent 锻造坊 · 从零到一掌握 Agent 开发
            </p>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--muted-foreground)',
                marginBottom: 12,
              }}
            >
              导航
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
              <Link to="/" style={{ textDecoration: 'none' }}>
                首页
              </Link>
              <Link to="/knowledge" style={{ textDecoration: 'none' }}>
                Agent知识
              </Link>
              <Link to="/llm" style={{ textDecoration: 'none' }}>
                LLM基础
              </Link>
              <Link to="/topics" style={{ textDecoration: 'none' }}>
                话题
              </Link>
              <Link to="/profile" style={{ textDecoration: 'none' }}>
                个人中心
              </Link>
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: 'var(--muted-foreground)',
                marginBottom: 12,
              }}
            >
              联系我们
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted-foreground)', lineHeight: 1.7, margin: 0 }}>
              <a href="mailto:daftpunk.wav@outlook.com" style={{ color: 'inherit' }}>
                daftpunk.wav@outlook.com
              </a>
              <br />
              <a href="mailto:daftpunkwav@gmail.com" style={{ color: 'inherit' }}>
                daftpunkwav@gmail.com
              </a>
            </p>
          </div>
        </div>
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '14px 24px',
            textAlign: 'center',
            fontSize: 12,
            color: 'var(--muted-foreground)',
          }}
        >
          AgentForge 2026 · 持续迭代中
        </div>
      </footer>

      <AgentFloat />

      <style>{`
        @media (max-width: 900px) {
          .header-search { display: none !important; }
        }
        @media (max-width: 768px) {
          .desktop-nav { display: none !important; }
          .mobile-only { display: inline-flex !important; }
        }
      `}</style>
    </>
  );
}
