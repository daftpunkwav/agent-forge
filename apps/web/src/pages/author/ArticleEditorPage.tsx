import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { ARTICLE_CATEGORIES } from '@agentforge/shared';
import type { AnimationDef } from '@agentforge/shared';
import { Field, Input, Select, TextArea } from '@/components/ui/Input';
// TextArea 仍用于摘要等字段
import { Button } from '@/components/ui/Button';
import { ArticleBody } from '@/components/article/ArticleBody';

export function ArticleEditorPage() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const navigate = useNavigate();
  const { isAuthor, isAdmin, loading: authLoading } = useAuth();
  const mdRef = useRef<HTMLTextAreaElement | null>(null);

  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [summary, setSummary] = useState('');
  const [markdown, setMarkdown] = useState(DEFAULT_MD);
  const [category, setCategory] = useState('工程实践');
  const [level, setLevel] = useState('入门');
  const [readMinutes, setReadMinutes] = useState(10);
  const [articleId, setArticleId] = useState<string | null>(isNew ? null : id!);
  const [animations, setAnimations] = useState<AnimationDef[]>([]);
  const [selectedAnimIds, setSelectedAnimIds] = useState<string[]>([]);
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<'edit' | 'preview'>('edit');

  useEffect(() => {
    if (!isAuthor) return;
    api.listAnimations(true).then((r) => setAnimations(r.items)).catch(() => setAnimations([]));
  }, [isAuthor]);

  useEffect(() => {
    if (isNew || !id) return;
    // 通过列表找 slug 再拉详情不优雅；用 list 找 id
    // admin 可编辑任意文章：用 status=all 覆盖他人文章（pageSize 取后端上限 48）；非 admin 仅本人文章
    api
      .listArticles(isAdmin ? { status: 'all', pageSize: 48 } : { mine: true })
      .then(async (r) => {
        const found = r.items.find((a) => a.id === id);
        if (!found) throw new Error('文章不存在');
        const detail = await api.getArticle(found.slug);
        const a = detail.article;
        setTitle(a.title);
        setSlug(a.slug);
        setSummary(a.summary);
        setMarkdown(a.markdown);
        setCategory(a.category);
        setLevel(a.level);
        setReadMinutes(a.readMinutes);
        setStatus(a.status);
        setArticleId(a.id);
        setSelectedAnimIds(a.animations?.map((x) => x.id) || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'));
  }, [id, isNew, isAdmin]);

  const previewAnims = useMemo(
    () => animations.filter((a) => selectedAnimIds.includes(a.id)),
    [animations, selectedAnimIds],
  );

  async function save(publish = false) {
    setError('');
    setSaving(true);
    try {
      const body = {
        title,
        slug: slug || undefined,
        summary,
        markdown,
        category,
        level,
        readMinutes,
        animationIds: selectedAnimIds,
        tags: [],
      };
      let currentId = articleId;
      if (!currentId) {
        const res = await api.createArticle(body);
        currentId = res.article.id;
        setArticleId(currentId);
        setSlug(res.article.slug);
        setStatus(res.article.status);
      } else {
        const res = await api.updateArticle(currentId, body);
        setStatus(res.article.status);
      }
      if (publish && currentId) {
        const res = await api.publishArticle(currentId);
        setStatus(res.article.status);
      }
      if (isNew && currentId) {
        navigate(`/author/articles/${currentId}/edit`, { replace: true });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  function insertAnimation(animId: string) {
    const fence = `\n\n:::animation{id="${animId}"}\n:::\n\n`;
    setMarkdown((m) => m + fence);
    if (!selectedAnimIds.includes(animId)) {
      setSelectedAnimIds((ids) => [...ids, animId]);
    }
  }

  /** 在光标/选区插入文本 */
  function insertAtCursor(snippet: string, selectInner?: { start: number; end: number }) {
    const ta = mdRef.current;
    if (!ta) {
      setMarkdown((m) => m + snippet);
      return;
    }
    const start = ta.selectionStart ?? markdown.length;
    const end = ta.selectionEnd ?? start;
    const next = markdown.slice(0, start) + snippet + markdown.slice(end);
    setMarkdown(next);
    requestAnimationFrame(() => {
      ta.focus();
      if (selectInner) {
        ta.setSelectionRange(start + selectInner.start, start + selectInner.end);
      } else {
        const pos = start + snippet.length;
        ta.setSelectionRange(pos, pos);
      }
    });
  }

  /** 将选区包成 [[术语|提示]] 悬停标注 */
  function wrapHoverTerm() {
    const ta = mdRef.current;
    const start = ta?.selectionStart ?? 0;
    const end = ta?.selectionEnd ?? 0;
    const selected = markdown.slice(start, end).trim() || '术语';
    const hint = window.prompt('可选：填写悬停讲解提示（留空则由 Agent 根据术语解释）', '') ?? '';
    const snippet = hint.trim() ? `[[${selected}|${hint.trim()}]]` : `[[${selected}]]`;
    if (ta && end > start) {
      const next = markdown.slice(0, start) + snippet + markdown.slice(end);
      setMarkdown(next);
    } else {
      insertAtCursor(snippet);
    }
  }

  function insertHoverImage() {
    const url = window.prompt('图片 URL', 'https://') || '';
    if (!url || url === 'https://') return;
    const alt = window.prompt('图片说明 / alt', '示意图') || '示意图';
    const hint = window.prompt('悬停时 Agent 讲解内容', alt) || alt;
    insertAtCursor(`\n\n![${alt}](${url}){agent="${hint}"}\n\n`);
  }

  function insertHoverSnippet() {
    insertAtCursor('[[多个候选想法|在 ToT 每一层生成的若干备选推理路径]]', {
      start: 2,
      end: 8,
    });
  }

  if (authLoading) return <div className="container" style={{ padding: 64 }}>加载中…</div>;
  if (!isAuthor) {
    return (
      <div className="container" style={{ padding: 64 }}>
        需要作者权限。<Link to="/author/apply">去申请</Link>
      </div>
    );
  }

  return (
    <div className="container" style={{ padding: '32px 24px 80px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, marginBottom: 20 }}>
        <div>
          <Link to="/author" style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>
            ← 返回工作台
          </Link>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: '8px 0 0' }}>
            {isNew ? '新建文章' : '编辑文章'}
          </h1>
          <div style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 4 }}>状态：{status}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="ghost" disabled={saving} onClick={() => save(false)}>
            保存草稿
          </Button>
          <Button disabled={saving} onClick={() => save(true)}>
            发布
          </Button>
        </div>
      </div>

      {error ? <p style={{ color: 'var(--destructive)' }}>{error}</p> : null}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <Field label="标题">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </Field>
        <Field label="Slug（可选）">
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="自动生成" />
        </Field>
        <Field label="分类">
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            {ARTICLE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="难度">
          <Select value={level} onChange={(e) => setLevel(e.target.value)}>
            <option value="入门">入门</option>
            <option value="中级">中级</option>
            <option value="高级">高级</option>
          </Select>
        </Field>
      </div>
      <Field label="摘要">
        <TextArea rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="预计阅读分钟">
        <Input
          type="number"
          min={1}
          max={120}
          value={readMinutes}
          onChange={(e) => setReadMinutes(Number(e.target.value) || 10)}
        />
      </Field>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>插入动画</div>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 0 }}>
          选择动画插入 Markdown 嵌入语法；读者端将渲染可播放可视化。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {animations.map((a) => (
            <Button key={a.id} size="sm" variant="ghost" onClick={() => insertAnimation(a.id)}>
              {a.name}
            </Button>
          ))}
          {!animations.length ? (
            <Link to="/author/animations/new" style={{ fontSize: 13 }}>
              先创建动画 →
            </Link>
          ) : null}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>悬停讲解标注</div>
        <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 0, lineHeight: 1.6 }}>
          读者悬停标注内容时，快速 Agent 只讲该词/句/图，而不是整章标题。
          <br />
          语法：<code>[[术语]]</code> 或 <code>[[术语|讲解提示]]</code>
          <br />
          图片：<code>![说明](url){'{'}agent=&quot;讲解&quot;{'}'}</code>
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Button size="sm" variant="secondary" onClick={wrapHoverTerm}>
            选区 → 悬停术语
          </Button>
          <Button size="sm" variant="ghost" onClick={insertHoverSnippet}>
            插入示例术语
          </Button>
          <Button size="sm" variant="ghost" onClick={insertHoverImage}>
            插入可讲解图片
          </Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Button size="sm" variant={tab === 'edit' ? 'primary' : 'ghost'} onClick={() => setTab('edit')}>
          编辑
        </Button>
        <Button size="sm" variant={tab === 'preview' ? 'primary' : 'ghost'} onClick={() => setTab('preview')}>
          预览（含悬停标注）
        </Button>
      </div>

      {tab === 'edit' ? (
        <textarea
          ref={mdRef}
          className="textarea"
          rows={24}
          value={markdown}
          onChange={(e) => setMarkdown(e.target.value)}
          style={{ fontFamily: 'var(--font-mono)', fontSize: 13, lineHeight: 1.6, width: '100%' }}
        />
      ) : (
        <div className="card" data-agent-zone="knowledge">
          <p style={{ fontSize: 12, color: 'var(--muted-foreground)', marginTop: 0 }}>
            预览中可悬停带下划线的术语试讲（需后端 Agent / BYOK）。
          </p>
          <ArticleBody markdown={markdown} animations={previewAnims} />
        </div>
      )}

      <style>{`
        @media (max-width: 800px) {
          .container [style*="grid-template-columns: 1fr 1fr"] {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </div>
  );
}

const DEFAULT_MD = `## 引言

在这里展开你的核心观点。好的技术文章应当**说清问题、给出现状、解释机制、给出可操作建议**。

## 核心概念

用多段文字说明概念。需要读者悬停讲解的词句，用双括号标注，例如：

ToT 会在每一层生成 [[多个候选想法|思维树每一层扩展出的备选推理路径]]，再通过评估与剪枝选择走向。

- 要点一：……
- 要点二：……

## 交互式演示

在需要处插入动画（点击上方「插入动画」）：

## 图片示例

![示意图](https://via.placeholder.com/640x320){agent="这张图用于说明 Agent 循环中的状态流转"}

## 实践建议

1. 先定义成功标准
2. 再选择模式与工具
3. 最后补齐评估与护栏
`;
