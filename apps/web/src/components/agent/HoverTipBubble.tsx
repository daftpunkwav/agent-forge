import { MarkdownView } from './MarkdownView';

export type HoverTipView = {
  x: number;
  y: number;
  text: string;
  loading?: boolean;
  topic?: string;
  anim: 'visible' | 'leaving';
};

export type HoverTipBox = {
  left: number;
  top: number;
  maxW: number;
  minW: number;
  maxH: number;
};

type Props = {
  tipRef: React.RefObject<HTMLDivElement | null>;
  hoverTip: HoverTipView;
  tipBox: HoverTipBox;
  tipEntered: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
};

/** 悬停快讲气泡 UI（与面板 Agent 分离） */
export function HoverTipBubble({
  tipRef,
  hoverTip,
  tipBox,
  tipEntered,
  onMouseEnter,
  onMouseLeave,
}: Props) {
  return (
    <div
      ref={tipRef}
      className={`agent-hover-tip ${
        hoverTip.anim === 'leaving' ? 'leaving' : tipEntered ? 'visible' : ''
      }`}
      style={{
        position: 'fixed',
        left: tipBox.left,
        top: tipBox.top,
        zIndex: 120,
        width: 'max-content',
        minWidth: tipBox.minW,
        maxWidth: tipBox.maxW,
        maxHeight: tipBox.maxH,
        overflow: 'auto',
        padding: '12px 14px',
        borderRadius: 14,
        border: '1px solid var(--border)',
        background: 'var(--popover)',
        color: 'var(--popover-foreground)',
        boxShadow: 'var(--shadow-lg)',
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {hoverTip.loading || !hoverTip.text ? (
        <div className="agent-thinking-indicator" aria-label="思考中">
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" style={{ animationDelay: '0.2s' }} />
          <span className="agent-thinking-dot" style={{ animationDelay: '0.4s' }} />
          <span>思考中…</span>
        </div>
      ) : (
        <MarkdownView source={hoverTip.text} compact />
      )}
    </div>
  );
}
