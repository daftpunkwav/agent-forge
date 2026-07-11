import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { TopicSummary } from '@agentforge/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select, TextArea } from '@/components/ui/Input';

export function TopicsPage() {
  const { can, user } = useAuth();
  const [items, setItems] = useState<TopicSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'discussion' | 'question' | 'opinion'>('discussion');
  const [articleSlug, setArticleSlug] = useState('');
  const [err, setErr] = useState('');

  async function reload() {
    setLoading(true);
    try {
      const r = await api.listTopics({ pageSize: 30 });
      setItems(r.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function create() {
    setErr('');
    try {
      await api.createTopic({
        title,
        body,
        kind,
        articleSlug: articleSlug.trim() || undefined,
      });
      setTitle('');
      setBody('');
      setArticleSlug('');
      await reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : '发布失败');
    }
  }

  return (
    <div className="container" style={{ padding: '40px 24px 80px', maxWidth: 880 }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, marginBottom: 8 }}>社区话题</h1>
      <p style={{ color: 'var(--muted-foreground)', marginTop: 0 }}>
        讨论、提问与观点；可附带文章 slug。登录读者及以上可发帖。
      </p>

      {can('topic.post') ? (
        <section className="card" style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: 16, marginTop: 0 }}>发帖</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            <Field label="标题">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
              <TextArea value={body} onChange={(e) => setBody(e.target.value)} rows={5} />
            </Field>
            {err ? <span style={{ color: 'var(--destructive)', fontSize: 13 }}>{err}</span> : null}
            <Button disabled={!title.trim() || !body.trim()} onClick={() => void create()}>
              发布
            </Button>
          </div>
        </section>
      ) : (
        <p style={{ fontSize: 14, color: 'var(--muted-foreground)' }}>
          {user ? '当前身份无法发帖' : (
            <>
              <Link to="/login">登录</Link> 后可以发帖
            </>
          )}
        </p>
      )}

      {loading ? (
        <p>加载中…</p>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
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

export function TopicDetailPage() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const [topic, setTopic] = useState<TopicSummary | null>(null);
  const [replies, setReplies] = useState<
    { id: string; body: string; createdAt: string; author: { id: string; name: string } }[]
  >([]);
  const [body, setBody] = useState('');

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
          <Button
            disabled={!body.trim()}
            onClick={async () => {
              await api.replyTopic(topic.id, body.trim());
              setBody('');
              const r = await api.getTopic(topic.id);
              setReplies(r.replies);
            }}
          >
            回复
          </Button>
        </div>
      ) : null}
    </div>
  );
}
