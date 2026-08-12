import { useMemo } from 'react';
import type { AnimationDef } from '@core/contracts';
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

  // 标题 id 序号跨 chunk 累计，避免不同 chunk 的同文本标题产生重复 id
  let headingSeq = 0;

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
        const heading = injectHeadingIds(renderMarkdown(part.content), headingSeq);
        headingSeq = heading.next;
        return (
          <div
            key={`m-${i}`}
            className="article-md-chunk"
            dangerouslySetInnerHTML={{ __html: heading.html }}
          />
        );
      })}
    </div>
  );
}
