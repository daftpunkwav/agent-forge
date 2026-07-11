import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';

export function ProfilePage() {
  const { user, loading, isAuthor, isAdmin, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return <div className="container" style={{ padding: 64 }}>加载中…</div>;
  }

  if (!user) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>请先登录</h2>
        <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none', marginTop: 16 }}>
          去登录
        </Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '40px 28px 80px', maxWidth: 800 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, marginBottom: 24 }}>个人中心</h1>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 22, fontWeight: 600 }}>{user.name}</div>
        <div style={{ color: 'var(--muted-foreground)', marginTop: 4 }}>{user.email}</div>
        <div style={{ marginTop: 8, fontFamily: 'var(--font-mono)', fontSize: 12 }}>角色：{user.role}</div>
      </div>

      {/* 账户与学习 */}
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
      </div>

      {/* 创作 / 管理：与常规设置分区 */}
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
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
          {isAuthor ? (
            <Link to="/author" className="card card-hover" style={{ textDecoration: 'none' }}>
              <div style={{ fontWeight: 600 }}>作者工作台</div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                写文章、管理动画与草稿
              </p>
            </Link>
          ) : (
            <Link to="/author/apply" className="card card-hover" style={{ textDecoration: 'none' }}>
              <div style={{ fontWeight: 600 }}>申请成为作者</div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                提交申请，审核通过后可发布
              </p>
            </Link>
          )}

          {isAdmin && (
            <Link to="/admin/domains" className="card card-hover" style={{ textDecoration: 'none' }}>
              <div style={{ fontWeight: 600 }}>领域管理</div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                增删 Agent / LLM 知识领域
              </p>
            </Link>
          )}

          {isAdmin && (
            <Link to="/author/applications" className="card card-hover" style={{ textDecoration: 'none' }}>
              <div style={{ fontWeight: 600 }}>作者申请审批</div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>
                审核读者成为作者的申请
              </p>
            </Link>
          )}
        </div>
      </div>

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
