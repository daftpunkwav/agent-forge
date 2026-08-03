import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Field, Input, TextArea } from '@/components/ui/Input';
import { api, setTokens } from '@/lib/api';

export function ProfilePage() {
  const { user, loading, isAuthor, isAdmin, isEliteAuthor, roleLabel, logout, refresh, can } =
    useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');
  const [website, setWebsite] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    setName(user.name || '');
    setHeadline(user.headline || '');
    setBio(user.bio || '');
    setWebsite(user.website || '');
  }, [user]);

  if (loading) {
    return <div className="container" style={{ padding: 64 }}>加载中…</div>;
  }

  if (!user) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>请先登录</h2>
        <p style={{ color: 'var(--muted-foreground)' }}>游客可浏览公开知识，登录后获得读者身份。</p>
        <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none', marginTop: 16 }}>
          去登录
        </Link>
      </div>
    );
  }

  async function saveProfile() {
    setSaving(true);
    setMsg('');
    try {
      const r = await api.updateProfile({
        name,
        headline,
        bio,
        website,
      });
      if (r.accessToken && r.refreshToken) setTokens(r.accessToken, r.refreshToken);
      await refresh();
      setMsg('资料已保存');
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="container" style={{ padding: '40px 28px 80px', maxWidth: 800 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, marginBottom: 8 }}>个人资料</h1>
      <p style={{ color: 'var(--muted-foreground)', marginTop: 0, marginBottom: 24 }}>
        当前身份：<strong style={{ color: 'var(--foreground)' }}>{roleLabel}</strong>
        {user.adminLevel >= 100 ? ' · 最高权限' : null}
      </p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{user.name}</div>
        <div style={{ color: 'var(--muted-foreground)', marginTop: 4 }}>{user.email}</div>
        <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          role={user.role} · tier={user.authorTier || 'none'} · adminLevel={user.adminLevel ?? 0}
        </div>
      </div>

      <section className="card" style={{ marginBottom: 24 }}>
        <h2 style={{ fontSize: 18, marginTop: 0 }}>编辑资料</h2>
        <div style={{ display: 'grid', gap: 12 }}>
          <Field label="昵称">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="一句话介绍">
            <Input value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="Agent 学习者 / 作者" />
          </Field>
          <Field label="简介">
            <TextArea value={bio} onChange={(e) => setBio(e.target.value)} rows={4} />
          </Field>
          <Field label="网站">
            <Input value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://" />
          </Field>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Button disabled={saving} onClick={() => void saveProfile()}>
              保存资料
            </Button>
            {msg ? <span style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>{msg}</span> : null}
          </div>
        </div>
      </section>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        <Link to="/settings" className="card card-hover" style={{ textDecoration: 'none' }}>
          <div style={{ fontWeight: 600 }}>账户设置</div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            动画、Agent 风格、BYOK
          </p>
        </Link>
        <Link to="/knowledge" className="card card-hover" style={{ textDecoration: 'none' }}>
          <div style={{ fontWeight: 600 }}>继续学习</div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            回到知识地图
          </p>
        </Link>
        <Link to="/topics" className="card card-hover" style={{ textDecoration: 'none' }}>
          <div style={{ fontWeight: 600 }}>社区话题</div>
          <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
            发帖讨论与提问
          </p>
        </Link>
        {!isAuthor && can('author.apply') && (
          <Link to="/author/apply" className="card card-hover" style={{ textDecoration: 'none' }}>
            <div style={{ fontWeight: 600 }}>申请成为作者</div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
              提交申请，审核通过后可发布
            </p>
          </Link>
        )}
        {isAuthor && !isEliteAuthor && !isAdmin && (
          <Link
            to="/author/apply?kind=elite"
            className="card card-hover"
            style={{ textDecoration: 'none' }}
          >
            <div style={{ fontWeight: 600 }}>申请优秀作者</div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
              获得更高内容权重与协作能力
            </p>
          </Link>
        )}
      </div>

      {/* 创作与管理：仅作者/管理员可见 */}
      {(isAuthor || isAdmin) && (
        <div style={{ marginTop: 28 }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: 'var(--muted-foreground)',
              marginBottom: 12,
            }}
          >
            创作与管理
          </div>
          <div
            style={{
              display: 'grid',
              gap: 12,
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            }}
          >
            {isAuthor && (
              <Link to="/author" className="card card-hover" style={{ textDecoration: 'none' }}>
                <div style={{ fontWeight: 600 }}>作者工作台</div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                  写文章、管理动画与草稿
                </p>
              </Link>
            )}
            {isAdmin && can('domain.manage') && (
              <Link to="/admin/domains" className="card card-hover" style={{ textDecoration: 'none' }}>
                <div style={{ fontWeight: 600 }}>领域管理</div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                  增删 Agent / LLM 知识领域
                </p>
              </Link>
            )}
            {isAdmin && (
              <Link
                to="/author/applications"
                className="card card-hover"
                style={{ textDecoration: 'none' }}
              >
                <div style={{ fontWeight: 600 }}>申请审批</div>
                <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                  作者 / 优秀作者申请
                </p>
              </Link>
            )}
          </div>
        </div>
      )}

      <div style={{ marginTop: 28 }}>
        <Button
          variant="ghost"
          onClick={async () => {
            await logout();
            navigate('/');
          }}
        >
          退出登录
        </Button>
      </div>
    </div>
  );
}
