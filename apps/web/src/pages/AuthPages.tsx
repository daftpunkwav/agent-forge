import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Field, Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ApiError } from '@/lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '登录失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="登录 AgentForge" subtitle="登录后可追踪学习进度并申请成为作者">
      <form onSubmit={onSubmit}>
        <Field label="邮箱">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密码">
          <Input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</p> : null}
        <Button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? '登录中…' : '登录'}
        </Button>
      </form>
      <p style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: 'var(--muted-foreground)' }}>
        还没有账号？<Link to="/register">立即注册</Link>
      </p>
    </AuthCard>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 8) {
      setError('密码至少 8 位');
      return;
    }
    setLoading(true);
    try {
      await register(email, password, name);
      navigate('/profile');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '注册失败');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard title="注册 AgentForge" subtitle="创建读者账号，开启系统化 Agent 学习">
      <form onSubmit={onSubmit}>
        <Field label="昵称">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="邮箱">
          <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="密码" hint="至少 8 个字符">
          <Input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error ? <p style={{ color: 'var(--destructive)', fontSize: 13 }}>{error}</p> : null}
        <Button type="submit" disabled={loading} style={{ width: '100%' }}>
          {loading ? '创建中…' : '注册'}
        </Button>
      </form>
      <p style={{ marginTop: 20, textAlign: 'center', fontSize: 14, color: 'var(--muted-foreground)' }}>
        已有账号？<Link to="/login">登录</Link>
      </p>
    </AuthCard>
  );
}

function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ maxWidth: 440, margin: '0 auto', padding: '64px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: '0 0 8px' }}>{title}</h1>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--muted-foreground)' }}>{subtitle}</p>
      </div>
      <div className="card" style={{ padding: 28 }}>
        {children}
      </div>
    </div>
  );
}
