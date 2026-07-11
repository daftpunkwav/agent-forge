import { useEffect, useState } from 'react';
import type { AnnotationItem } from '@agentforge/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';

const PREF_KEY = 'agentforge-ann-open';
const PANEL_W = 300;
/** 收起时露出的细把手宽度（尽量不显眼） */
const TAB_W = 10;

/**
 * 贴在视口最右侧的批注抽屉：
 * - 收起：几乎只剩细边把手
 * - 展开：从右向左滑入
 * - 收起：从左向右滑出
 */
export function AnnotationPanel({
  articleSlug,
  articleId,
  isArticleAuthor,
}: {
  articleSlug: string;
  articleId?: string;
  isArticleAuthor?: boolean;
}) {
  const { user, can, isAdmin } = useAuth();
  const [open, setOpen] = useState(() => localStorage.getItem(PREF_KEY) === '1');
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [body, setBody] = useState('');
  const [anchor, setAnchor] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  function setOpenPersist(v: boolean) {
    setOpen(v);
    localStorage.setItem(PREF_KEY, v ? '1' : '0');
  }

  async function reload() {
    setLoading(true);
    try {
      const r = await api.listAnnotations(articleSlug);
      setItems(r.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, [articleSlug]);

  async function submit() {
    if (!body.trim()) return;
    setErr('');
    try {
      await api.createAnnotation({
        articleSlug,
        articleId,
        anchorText: anchor,
        body: body.trim(),
      });
      setBody('');
      setAnchor('');
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '提交失败');
    }
  }

  async function review(id: string, status: 'approved' | 'rejected') {
    await api.reviewAnnotation(id, status);
    await reload();
  }

  return (
    <>
      {/* 固定在视口最右侧，不挤占正文布局 */}
      <aside
        className={`annotation-drawer${open ? ' is-open' : ''}`}
        aria-label="批注面板"
        style={{
          position: 'fixed',
          top: 'var(--header-h, 64px)',
          right: 0,
          zIndex: 40,
          width: PANEL_W,
          height: 'calc(100vh - var(--header-h, 64px))',
          display: 'flex',
          flexDirection: 'row',
          /* 收起：向右滑出，仅留 TAB；展开：translateX(0) 从右向左进入 */
          transform: open
            ? 'translateX(0)'
            : `translateX(calc(100% - ${TAB_W}px))`,
          transition: 'transform 0.28s cubic-bezier(0.4, 0, 0.2, 1)',
          willChange: 'transform',
          pointerEvents: 'none',
        }}
      >
        {/* 细把手：贴在面板左缘，收起时落在屏幕最右侧 */}
        <button
          type="button"
          className="annotation-tab"
          aria-expanded={open}
          aria-label={open ? '收起批注' : '展开批注'}
          title={open ? '收起批注' : '批注'}
          onClick={() => setOpenPersist(!open)}
          style={{
            pointerEvents: 'auto',
            flex: `0 0 ${TAB_W}px`,
            width: TAB_W,
            alignSelf: 'stretch',
            margin: 0,
            padding: 0,
            border: 'none',
            borderLeft: '1px solid color-mix(in srgb, var(--border) 70%, transparent)',
            borderRadius: open ? '10px 0 0 10px' : 0,
            background: open
              ? 'color-mix(in srgb, var(--card) 92%, transparent)'
              : 'color-mix(in srgb, var(--muted) 55%, transparent)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: open ? 0.85 : 0.45,
            transition: 'opacity 0.2s ease, background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.opacity = '0.9';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.opacity = open ? '0.85' : '0.45';
          }}
        >
          <span
            aria-hidden
            style={{
              width: 2,
              height: 28,
              borderRadius: 2,
              background: 'color-mix(in srgb, var(--muted-foreground) 50%, transparent)',
            }}
          />
        </button>

        {/* 内容区：始终渲染，靠 transform 进出，保证动画方向正确 */}
        <div
          className="annotation-drawer-body"
          style={{
            pointerEvents: open ? 'auto' : 'none',
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'color-mix(in srgb, var(--popover) 96%, transparent)',
            borderLeft: '1px solid var(--border)',
            boxShadow: open ? '-8px 0 28px color-mix(in srgb, #000 12%, transparent)' : 'none',
            backdropFilter: 'blur(10px)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px 8px',
              borderBottom: '1px solid var(--border)',
              flexShrink: 0,
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 13 }}>批注</span>
            <button
              type="button"
              onClick={() => setOpenPersist(false)}
              aria-label="收起"
              style={{
                border: 'none',
                background: 'transparent',
                color: 'var(--muted-foreground)',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                padding: '2px 6px',
                borderRadius: 6,
              }}
            >
              ›
            </button>
          </div>

          <div style={{ padding: '10px 14px 16px', overflow: 'auto', flex: 1 }}>
            <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px', lineHeight: 1.5 }}>
              {user
                ? '提交后需作者 / Agent / 管理员审核'
                : '游客可查看已通过批注；登录后可提交'}
            </p>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 11,
                color: 'var(--muted-foreground)',
                marginBottom: 12,
              }}
            >
              默认展开
              <input
                type="checkbox"
                checked={open}
                onChange={(e) => setOpenPersist(e.target.checked)}
              />
            </label>

            {loading ? (
              <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>加载…</p>
            ) : items.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>暂无批注</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
                {items.map((a) => (
                  <li
                    key={a.id}
                    className="card"
                    style={{ padding: 10, fontSize: 12, lineHeight: 1.5 }}
                  >
                    <div style={{ fontWeight: 600 }}>{a.user?.name || '用户'}</div>
                    {a.anchorText ? (
                      <div style={{ color: 'var(--muted-foreground)', margin: '4px 0' }}>
                        「{a.anchorText.slice(0, 60)}」
                      </div>
                    ) : null}
                    <div>{a.body}</div>
                    <div style={{ marginTop: 4, opacity: 0.6, fontFamily: 'var(--font-mono)' }}>
                      {a.status}
                    </div>
                    {(isArticleAuthor || isAdmin) && a.status === 'pending' ? (
                      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                        <Button size="sm" onClick={() => void review(a.id, 'approved')}>
                          通过
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => void review(a.id, 'rejected')}>
                          拒绝
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}

            {can('annotation.write') ? (
              <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                <input
                  className="input"
                  placeholder="锚定原文（可选）"
                  value={anchor}
                  onChange={(e) => setAnchor(e.target.value)}
                  style={{ minHeight: 34, fontSize: 12 }}
                />
                <textarea
                  className="input"
                  placeholder="写下批注…"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  style={{ fontSize: 13 }}
                />
                {err ? <span style={{ color: 'var(--destructive)', fontSize: 12 }}>{err}</span> : null}
                <Button size="sm" disabled={!body.trim()} onClick={() => void submit()}>
                  提交批注
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}
