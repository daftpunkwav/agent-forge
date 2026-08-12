import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { DomainSummary } from '@core/contracts';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, TextArea } from '@/components/ui/Input';
import { Tag } from '@/components/ui/Tag';

export function DomainsAdminPage() {
  const { isAdmin, loading } = useAuth();
  const [items, setItems] = useState<DomainSummary[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [track, setTrack] = useState<'agent' | 'llm'>('agent');

  async function load() {
    const r = await api.listDomains(undefined, true);
    setItems(r.items);
  }

  useEffect(() => {
    if (!isAdmin) return;
    load().catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'));
  }, [isAdmin]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError('');
    // 后端校验 slug 正则 ^[a-z0-9-]+$，中文名自动生成的 slug 必被拒，提交前先校验并提示手动修改
    const finalSlug = slug || name.toLowerCase().replace(/\s+/g, '-');
    if (!/^[a-z0-9-]+$/.test(finalSlug)) {
      setError('Slug 只能包含小写字母、数字和连字符（-），请在 Slug 输入框中手动修改');
      return;
    }
    try {
      await api.createDomain({
        name,
        slug: finalSlug,
        description,
        track,
        published: true,
      });
      setName('');
      setSlug('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '创建失败');
    }
  }

  async function remove(id: string) {
    if (!confirm('删除领域？（文章不会删除，仅解除关联）')) return;
    try {
      await api.deleteDomain(id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败');
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
    <div className="container" style={{ padding: '40px 24px 80px', maxWidth: 880 }}>
      <Link to="/author" style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
        ← 工作台
      </Link>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: '12px 0 8px' }}>领域管理</h1>
      <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>
        管理员可添加 Agent 知识 / LLM 基础赛道下的领域。读者端按领域展示，每页 8 篇文章。
      </p>

      {error ? <p style={{ color: 'var(--destructive)' }}>{error}</p> : null}

      <form className="card" onSubmit={onCreate} style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>新建领域</h2>
        <Field label="名称">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Slug" hint="URL 标识，如 reasoning">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="自动生成" />
        </Field>
        <Field label="赛道">
          <Select value={track} onChange={(e) => setTrack(e.target.value as 'agent' | 'llm')}>
            <option value="agent">Agent 知识</option>
            <option value="llm">LLM 基础</option>
          </Select>
        </Field>
        <Field label="描述">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <Button type="submit">创建</Button>
      </form>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {items.map((d) => (
          <div key={d.id} className="card" style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                <Tag variant="primary">{d.track}</Tag>
                <Tag>{d.articleCount ?? 0} 篇</Tag>
                {!d.published ? <Tag variant="outline">隐藏</Tag> : null}
              </div>
              <div style={{ fontWeight: 600 }}>{d.name}</div>
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>/{d.slug}</div>
              <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted-foreground)' }}>{d.description}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Link to={`/domains/${d.slug}`} className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
                预览
              </Link>
              <Button size="sm" variant="ghost" onClick={() => remove(d.id)}>
                删除
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
