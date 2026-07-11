import type { ReactNode } from 'react';
import { Tag } from '@/components/ui/Tag';
import { TableOfContents } from './TableOfContents';

export function ArticleLayout({
  tags,
  title,
  summary,
  meta,
  children,
}: {
  tags?: ReactNode;
  title: string;
  summary?: string;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="container" style={{ padding: '28px 28px', display: 'flex', gap: 40 }}>
      <TableOfContents />
      <article style={{ flex: 1, minWidth: 0, maxWidth: 760 }}>
        <header style={{ marginBottom: 40 }}>
          {tags ? <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>{tags}</div> : null}
          <h1
            style={{
              fontFamily: 'var(--font-serif)',
              fontWeight: 600,
              letterSpacing: '-0.02em',
              fontSize: 'clamp(28px, 4vw, 44px)',
              lineHeight: 1.18,
              margin: '0 0 16px',
            }}
          >
            {title}
          </h1>
          {summary ? (
            <p style={{ fontSize: 17, lineHeight: 1.7, color: 'var(--muted-foreground)', maxWidth: 640, margin: 0 }}>
              {summary}
            </p>
          ) : null}
          {meta ? (
            <div style={{ marginTop: 16, fontSize: 13, color: 'var(--muted-foreground)' }}>{meta}</div>
          ) : null}
        </header>
        {children}
        <section
          style={{
            marginTop: 64,
            paddingTop: 32,
            borderTop: '1px solid var(--border)',
          }}
        >
          <h3 style={{ fontFamily: 'var(--font-serif)', fontSize: 20, fontWeight: 600, marginBottom: 12 }}>
            讨论
          </h3>
          <p style={{ fontSize: 14, color: 'var(--muted-foreground)', fontStyle: 'italic', margin: 0 }}>
            评论功能即将推出，敬请期待。
          </p>
        </section>
      </article>
    </div>
  );
}

export function ArticleTags({
  category,
  level,
  readMinutes,
}: {
  category?: string;
  level?: string;
  readMinutes?: number;
}) {
  return (
    <>
      {category ? <Tag variant="primary">{category}</Tag> : null}
      {level ? <Tag>{level}</Tag> : null}
      {readMinutes ? <Tag>{readMinutes} min read</Tag> : null}
    </>
  );
}
