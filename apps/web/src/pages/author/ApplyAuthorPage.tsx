import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { api, ApiError } from '@/lib/api';
import { Field, Select, TextArea } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

export function ApplyAuthorPage() {
  const { user, isAuthor, loading } = useAuth();
  const navigate = useNavigate();
  const [field, setField] = useState('');
  const [bio, setBio] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setOk('');
    setSubmitting(true);
    try {
      await api.applyAuthor({ field, bio });
      setOk('申请已提交，管理员审核通过后你将获得作者权限。');
      setTimeout(() => navigate('/profile'), 1500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="container" style={{ padding: 64 }}>加载中…</div>;

  if (!user) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>请先登录再申请</h2>
        <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          登录
        </Link>
      </div>
    );
  }

  if (isAuthor) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>你已是作者</h2>
        <Link to="/author" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          进入工作台
        </Link>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: '64px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: '0 0 8px' }}>申请成为作者</h1>
        <p style={{ margin: 0, color: 'var(--muted-foreground)', fontSize: 14 }}>
          分享高质量 Agent 知识，使用 Markdown 与动画工具
        </p>
      </div>
      <div className="card" style={{ padding: 28 }}>
        <form onSubmit={onSubmit}>
          <Field label="专业领域">
            <Select required value={field} onChange={(e) => setField(e.target.value)}>
              <option value="">选择领域</option>
              <option value="推理模式">推理模式</option>
              <option value="框架">Agent 框架</option>
              <option value="协议">协议标准</option>
              <option value="工程">工程实践</option>
              <option value="llm">LLM 基础</option>
            </Select>
          </Field>
          <Field label="自我介绍" hint="至少 10 字，说明经验与可贡献内容">
            <TextArea required minLength={10} rows={5} value={bio} onChange={(e) => setBio(e.target.value)} />
          </Field>
          {error ? <p style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</p> : null}
          {ok ? <p style={{ color: 'var(--chart-3)', fontSize: 13 }}>{ok}</p> : null}
          <Button type="submit" disabled={submitting} style={{ width: '100%' }}>
            {submitting ? '提交中…' : '提交申请'}
          </Button>
        </form>
      </div>
      <div className="card" style={{ marginTop: 20, background: 'var(--muted)' }}>
        <h3 style={{ fontSize: 15, marginTop: 0 }}>作者权益</h3>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, lineHeight: 1.9 }}>
          <li>发布高质量技术文章</li>
          <li>模板化动画步骤编辑与文章嵌入</li>
          <li>Markdown 编辑与预览</li>
        </ul>
      </div>
    </div>
  );
}
