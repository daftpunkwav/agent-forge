import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { AnnotationItem, ArticleDetail } from '@agentforge/shared';
import { ArticleBody } from '@/components/article/ArticleBody';
import { ArticleLayout, ArticleTags } from '@/components/article/ArticleLayout';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/hooks/useAuth';

/** slug → 默认动画模板（种子文章用） */
const SLUG_TEMPLATE: Record<string, string> = {
  react: 'react',
  cot: 'cot',
  tot: 'tot',
  got: 'got',
  mcp: 'mcp',
  context: 'loop',
  loop: 'loop',
  harness: 'harness',
  memory: 'memory',
  evaluation: 'loop',
  'tool-use': 'tool',
  'prompt-eng': 'cot',
  'frameworks-langchain': 'loop',
  'frameworks-autogen': 'loop',
  'frameworks-crewai': 'loop',
  'llm-basics': 'cot',
  transformers: 'cot',
  tokenization: 'cot',
  'fine-tuning': 'cot',
  prompting: 'cot',
};

export function ArticlePage() {
  const { slug = '' } = useParams();
  const { user } = useAuth();
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api
      .getArticle(slug)
      .then((r) => {
        if (!cancelled) setArticle(r.article);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        if (e instanceof ApiError) setError(e.message);
        else setError('加载失败');
        setArticle(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  if (loading) {
    return (
      <div className="container" style={{ padding: 80, textAlign: 'center', color: 'var(--muted-foreground)' }}>
        加载中…
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="container" style={{ padding: 80, textAlign: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-serif)' }}>文章未找到</h2>
        <p style={{ color: 'var(--muted-foreground)' }}>{error || '请从知识总览进入'}</p>
      </div>
    );
  }

  return (
    <ArticleLayout
      title={article.title}
      summary={article.summary}
      articleSlug={article.slug}
      tags={
        <ArticleTags
          category={article.category}
          level={article.level}
          readMinutes={article.readMinutes}
        />
      }
      meta={
        <>
          {article.author?.name ? <span>{article.author.name}</span> : null}
          {article.publishedAt ? (
            <span> · {new Date(article.publishedAt).toLocaleDateString('zh-CN')}</span>
          ) : null}
          <span style={{ marginLeft: 12 }}>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                window.dispatchEvent(
                  new CustomEvent('agentforge:explain', {
                    detail: {
                      text: `${article.title}\n\n${article.summary}\n\n${article.markdown.slice(0, 3000)}`,
                      title: article.title,
                      articleSlug: article.slug,
                    },
                  }),
                );
              }}
            >
              Agent 详细讲解
            </Button>
          </span>
          {user ? (
            <span style={{ marginLeft: 8 }}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void api.agentProgress({
                    articleSlug: article.slug,
                    progress: 1,
                    mastery: 'mastered',
                  })
                }
              >
                标记已掌握
              </Button>
            </span>
          ) : null}
        </>
      }
    >
      {/* 勿在外层包 data-agent-topic，否则整篇都会讲成文章标题 */}
      <ArticleBody
        markdown={article.markdown}
        animations={article.animations}
        fallbackTemplate={SLUG_TEMPLATE[article.slug]}
      />
      <ArticleAnnotations slug={article.slug} canWrite={Boolean(user)} />
    </ArticleLayout>
  );
}

/** 最小批注列表 + 提交表单（无审核 UI） */
function ArticleAnnotations({ slug, canWrite }: { slug: string; canWrite: boolean }) {
  const [items, setItems] = useState<AnnotationItem[]>([]);
  const [anchorText, setAnchorText] = useState('');
  const [body, setBody] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    api
      .listAnnotations({ articleSlug: slug })
      .then((r) => {
        if (!cancelled) setItems(r.items);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  return (
    <section style={{ marginTop: 48, paddingTop: 24, borderTop: '1px solid var(--border)' }}>
      <h3 style={{ fontFamily: 'var(--font-serif)', marginBottom: 12 }}>批注</h3>
      <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 16px', color: 'var(--muted-foreground)' }}>
        {items.length === 0 ? <li>暂无可见批注</li> : null}
        {items.map((a) => (
          <li key={a.id} style={{ marginBottom: 10 }}>
            <strong style={{ color: 'var(--foreground)' }}>{a.user?.name || '用户'}</strong>
            {a.anchorText ? ` · 「${a.anchorText.slice(0, 40)}」` : null}
            <div>{a.body}</div>
            <small>{a.status}</small>
          </li>
        ))}
      </ul>
      {canWrite ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErr('');
            void api
              .createAnnotation({ articleSlug: slug, anchorText, body })
              .then((r) => {
                setItems((prev) => [r.annotation, ...prev]);
                setAnchorText('');
                setBody('');
              })
              .catch((ex: unknown) => setErr(ex instanceof ApiError ? ex.message : '提交失败'));
          }}
          style={{ display: 'grid', gap: 8, maxWidth: 480 }}
        >
          <input
            placeholder="锚定原文（选中片段）"
            value={anchorText}
            onChange={(e) => setAnchorText(e.target.value)}
            required
          />
          <textarea
            placeholder="批注内容"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            required
            rows={3}
          />
          {err ? <span style={{ color: 'var(--destructive)' }}>{err}</span> : null}
          <Button type="submit" size="sm">
            提交批注
          </Button>
        </form>
      ) : (
        <p style={{ color: 'var(--muted-foreground)', fontSize: 14 }}>登录后可提交批注</p>
      )}
    </section>
  );
}
