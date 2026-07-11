import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Tag } from '@/components/ui/Tag';

interface AppRow {
  id: string;
  field: string;
  bio: string;
  status: string;
  createdAt: string;
  user: { id: string; email: string; name: string; role: string };
}

export function ApplicationsAdminPage() {
  const { isAdmin, loading } = useAuth();
  const [items, setItems] = useState<AppRow[]>([]);
  const [error, setError] = useState('');

  async function load() {
    const r = await api.listApplications();
    setItems(r.items as AppRow[]);
  }

  useEffect(() => {
    if (!isAdmin) return;
    load().catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'));
  }, [isAdmin]);

  async function review(id: string, status: 'approved' | 'rejected') {
    try {
      await api.reviewApplication(id, status);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '操作失败');
    }
  }

  if (loading) return <div className="container" style={{ padding: 64 }}>加载中…</div>;
  if (!isAdmin) {
    return (
      <div className="container" style={{ padding: 64 }}>
        需要管理员权限
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '48px 24px' }}>
      <Link to="/author" style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
        ← 工作台
      </Link>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: '12px 0 24px' }}>作者申请审批</h1>
      {error ? <p style={{ color: 'var(--destructive)' }}>{error}</p> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {items.map((a) => (
          <div key={a.id} className="card">
            <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <Tag variant={a.status === 'pending' ? 'primary' : 'muted'}>{a.status}</Tag>
              <Tag>{a.field}</Tag>
            </div>
            <div style={{ fontWeight: 600 }}>
              {a.user.name} · {a.user.email}
            </div>
            <p style={{ fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.6 }}>{a.bio}</p>
            {a.status === 'pending' ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <Button size="sm" onClick={() => review(a.id, 'approved')}>
                  通过
                </Button>
                <Button size="sm" variant="ghost" onClick={() => review(a.id, 'rejected')}>
                  拒绝
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        {!items.length ? <p style={{ color: 'var(--muted-foreground)' }}>暂无申请</p> : null}
      </div>
    </div>
  );
}
