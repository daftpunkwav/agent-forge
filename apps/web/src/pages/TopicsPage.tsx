import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { TopicSummary } from '@core/contracts';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, TextArea } from '@/components/ui/Input';

/** 话题列表：以浏览为主，发布入口独立 */
export function TopicsPage() {
  const { can, user } = useAuth();
  const [items, setItems] = useState<TopicSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .listTopics({ pageSize: 40 })
      .then((r) => setItems(r.items))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="container" style={{ padding: '40px 24px 80px', maxWidth: 880 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          marginBottom: 8,
        }}
      >
        <div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, margin: '0 0 8px' }}>社区话题</h1>
          <p style={{ color: 'var(--muted-foreground)', margin: 0 }}>
            浏览讨论、提问与观点；可附带知识文章展开交流。
          </p>
        </div>
        {can('topic.post') ? (
          <Link to="/topics/new" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
            发布话题
          </Link>
        ) : (
          <Link to="/login" className="btn btn-ghost btn-sm" style={{ textDecoration: 'none' }}>
            {user ? '无发帖权限' : '登录后发布'}
          </Link>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--muted-foreground)', marginTop: 32 }}>加载中…</p>
      ) : items.length === 0 ? (
        <div className="card" style={{ marginTop: 28 }}>
          <p style={{ margin: 0 }}>还没有话题。</p>
          {can('topic.post') ? (
            <Link to="/topics/new" style={{ fontSize: 14 }}>
              成为第一个发帖的人 →
            </Link>
          ) : null}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12, marginTop: 28 }}>
          {items.map((t) => (
            <Link
              key={t.id}
              to={`/topics/${t.id}`}
              className="card card-hover"
              style={{ textDecoration: 'none', display: 'block' }}
            >
              <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginBottom: 6 }}>
                {t.kind} · {t.author.name} · 回复 {t.replyCount}
              </div>
              <div style={{ fontWeight: 600, fontSize: 17 }}>{t.title}</div>
              <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--muted-foreground)' }}>
                {t.body.slice(0, 160)}
                {t.body.length > 160 ? '…' : ''}
              </p>
              {t.article ? (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--primary)' }}>
                  关联：{t.article.title}
                </div>
              ) : null}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

/** 发布话题（独立入口） */
export function TopicNewPage() {
  const { can, user } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'discussion' | 'question' | 'opinion'>('discussion');
  const [articleSlug, setArticleSlug] = useState(sp.get('article') || '');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!user) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>请先登录</h2>
        <Link to="/login" className="btn btn-primary" style={{ textDecoration: 'none' }}>
          去登录
        </Link>
      </div>
    );
  }

  if (!can('topic.post')) {
    return (
      <div className="container" style={{ padding: 64, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>当前身份无法发帖</h2>
        <Link to="/topics" style={{ fontSize: 14 }}>
          返回话题列表
        </Link>
      </div>
    );
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const r = await api.createTopic({
        title: title.trim(),
        body: body.trim(),
        kind,
        articleSlug: articleSlug.trim() || undefined,
      });
      navigate(`/topics/${r.topic.id}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : '发布失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px', maxWidth: 640 }}>
      <Link to="/topics" style={{ fontSize: 13 }}>
        ← 返回话题
      </Link>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, marginTop: 12 }}>发布话题</h1>
      <form className="card" onSubmit={onSubmit} style={{ marginTop: 20 }}>
        <Field label="标题">
          <Input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </Field>
        <Field label="类型">
          <Select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="discussion">讨论</option>
            <option value="question">提问</option>
            <option value="opinion">观点</option>
          </Select>
        </Field>
        <Field label="关联文章 slug（可选）">
          <Input
            value={articleSlug}
            onChange={(e) => setArticleSlug(e.target.value)}
            placeholder="react"
          />
        </Field>
        <Field label="正文">
          <TextArea required value={body} onChange={(e) => setBody(e.target.value)} rows={8} />
        </Field>
        {err ? <p style={{ color: 'var(--destructive)', fontSize: 13 }}>{err}</p> : null}
        <Button type="submit" disabled={submitting || !title.trim() || !body.trim()}>
          {submitting ? '发布中…' : '发布'}
        </Button>
      </form>
    </div>
  );
}

export function TopicDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [topic, setTopic] = useState<TopicSummary | null>(null);
  const [replies, setReplies] = useState<
    { id: string; body: string; createdAt: string; author: { id: string; name: string } }[]
  >([]);
  const [body, setBody] = useState('');
  const [replyErr, setReplyErr] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!id) return;
    api
      .getTopic(id)
      .then((r) => {
        setTopic(r.topic);
        setReplies(r.replies);
      })
      .catch(() => setTopic(null));
  }, [id]);

  if (!topic) {
    return <div className="container" style={{ padding: 64 }}>加载中或话题不存在…</div>;
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px', maxWidth: 800 }}>
      <Link to="/topics" style={{ fontSize: 13 }}>
        ← 返回话题
      </Link>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 32 }}>{topic.title}</h1>
      <p style={{ color: 'var(--muted-foreground)' }}>
        {topic.author.name} · {topic.kind}
      </p>
      <div className="card" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>
        {topic.body}
      </div>
      {topic.article ? (
        <p>
          关联文章：
          <Link to={`/knowledge/${topic.article.slug}`}>{topic.article.title}</Link>
        </p>
      ) : null}

      <h2 style={{ marginTop: 32, fontSize: 18 }}>回复</h2>
      <div style={{ display: 'grid', gap: 10, marginBottom: 20 }}>
        {replies.map((r) => (
          <div key={r.id} className="card" style={{ padding: 12, fontSize: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{r.author.name}</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{r.body}</div>
          </div>
        ))}
      </div>

      {can('topic.post') ? (
        <div style={{ display: 'grid', gap: 8 }}>
          <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={3} />
          {replyErr ? <p style={{ color: 'var(--destructive)', fontSize: 13, margin: 0 }}>{replyErr}</p> : null}
          <Button
            disabled={submitting || !body.trim()}
            onClick={async () => {
              setReplyErr('');
              setSubmitting(true);
              try {
                await api.replyTopic(topic.id, body.trim());
                setBody('');
                const r = await api.getTopic(topic.id);
                setReplies(r.replies);
              } catch (ex) {
                setReplyErr(ex instanceof Error ? ex.message : '回复失败');
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? '提交中…' : '回复'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
