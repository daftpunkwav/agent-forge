import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import type { ArticleDetail } from '@agentforge/shared';
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
    </ArticleLayout>
  );
}
