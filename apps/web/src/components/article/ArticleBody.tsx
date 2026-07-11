import { useMemo } from 'react';
import type { AnimationDef } from '@agentforge/shared';
import {
  injectHeadingIds,
  renderMarkdown,
  splitMarkdownWithAnimations,
} from '@/lib/markdown';
import { AnimationViewer, TemplateAnimation } from '@/components/anim/AnimationViewer';

export function ArticleBody({
  markdown,
  animations = [],
  fallbackTemplate,
}: {
  markdown: string;
  animations?: AnimationDef[];
  /** 若正文未嵌入动画，可在文首展示模板动画 */
  fallbackTemplate?: string;
}) {
  const parts = useMemo(() => splitMarkdownWithAnimations(markdown), [markdown]);
  const animMap = useMemo(() => {
    const m = new Map<string, AnimationDef>();
    animations.forEach((a) => m.set(a.id, a));
    return m;
  }, [animations]);

  const hasEmbedded = parts.some((p) => p.type === 'animation');

  return (
    <div className="article-prose" data-article-body data-agent-zone="knowledge">
      {!hasEmbedded && fallbackTemplate ? (
        <TemplateAnimation template={fallbackTemplate} name={`${fallbackTemplate.toUpperCase()} 演示`} />
      ) : null}
      {parts.map((part, i) => {
        if (part.type === 'animation') {
          const anim = animMap.get(part.id);
          if (anim) return <AnimationViewer key={`a-${i}`} animation={anim} />;
          return <TemplateAnimation key={`a-${i}`} template={part.id} name={part.id} />;
        }
        const html = injectHeadingIds(renderMarkdown(part.content));
        return (
          <div
            key={`m-${i}`}
            className="article-md-chunk"
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
    </div>
  );
}
