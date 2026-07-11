import { useEffect, useState } from 'react';
import type { AnnotationItem } from '@agentforge/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';

const PREF_KEY = 'agentforge-ann-open';

/**
 * 文章右侧批注栏：可收起；默认收起/展开由本机偏好决定
 * 游客只读已通过；读者可写待审
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
    <aside
      className="annotation-panel"
      style={{
        width: open ? 280 : 40,
        flexShrink: 0,
        transition: 'width 0.22s ease',
        borderLeft: '1px solid var(--border)',
        background: 'var(--card)',
        alignSelf: 'stretch',
        position: 'sticky',
        top: 80,
        maxHeight: 'calc(100vh - 100px)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpenPersist(!open)}
        style={{ margin: 8, alignSelf: open ? 'flex-end' : 'center' }}
        title={open ? '收起批注' : '展开批注'}
      >
        {open ? '⟩' : '⟨'}
      </button>
      {open ? (
        <div style={{ padding: '0 12px 16px', overflow: 'auto', flex: 1 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>批注</div>
          <p style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
            {user
              ? '读者可提交；需作者/Agent/管理员审核后公开'
              : '游客可查看已通过批注，登录后可提交'}
          </p>
          <label style={{ fontSize: 11, color: 'var(--muted-foreground)' }}>
            默认
            <select
              className="input"
              style={{ minHeight: 32, fontSize: 12, marginTop: 4, marginBottom: 12 }}
              value={open ? '1' : '0'}
              onChange={(e) => setOpenPersist(e.target.value === '1')}
            >
              <option value="0">收起</option>
              <option value="1">展开</option>
            </select>
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
      ) : (
        <div
          style={{
            writingMode: 'vertical-rl',
            fontSize: 11,
            letterSpacing: '0.12em',
            color: 'var(--muted-foreground)',
            margin: '12px auto',
          }}
        >
          批注
        </div>
      )}
    </aside>
  );
}
