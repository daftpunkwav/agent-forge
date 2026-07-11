import { useMemo } from 'react';
import { renderMarkdown } from '@/lib/markdown';

/** Agent 气泡 / 悬停提示用 Markdown 渲染 */
export function MarkdownView({
  source,
  className = '',
  compact = false,
}: {
  source: string;
  className?: string;
  compact?: boolean;
}) {
  const html = useMemo(() => renderMarkdown(source || ''), [source]);
  return (
    <div
      className={`agent-md${compact ? ' agent-md-compact' : ''} ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
