import { Button } from '@/components/ui/Button';
import type { ChatMsg } from '@/hooks/useAgentPanel';
import { MarkdownView } from './MarkdownView';

import { HOVER_REVEAL_MS } from './hoverConstants';

type Props = {
  open: boolean;
  onClose: () => void;
  showHelp: boolean;
  onToggleHelp: () => void;
  messages: ChatMsg[];
  input: string;
  setInput: (v: string) => void;
  busy: boolean;
  send: () => Promise<void>;
  toggleThinking: (index: number) => void;
  toolsEnabled: boolean;
  setToolsEnabled: (v: boolean) => void;
  onToggleOpen: () => void;
  floatRef: React.RefObject<HTMLDivElement | null>;
};

/** Agent 助手面板 UI（与悬停快讲分离） */
export function AgentPanel({
  open,
  onClose,
  showHelp,
  onToggleHelp,
  messages,
  input,
  setInput,
  busy,
  send,
  toggleThinking,
  toolsEnabled,
  setToolsEnabled,
  onToggleOpen,
  floatRef,
}: Props) {
  return (
    <div className="agent-float" ref={floatRef}>
      <div className={`agent-panel${open ? ' open' : ''}`}>
        <div className="agent-panel-header">
          <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, letterSpacing: '0.05em' }}>
            AGENT
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleHelp} title="模式说明">
              ?
            </button>
            <button type="button" className="btn btn-ghost btn-sm" aria-label="关闭" onClick={onClose}>
              ×
            </button>
          </div>
        </div>

        {showHelp ? (
          <div
            style={{
              padding: '10px 14px',
              fontSize: 12,
              lineHeight: 1.55,
              borderBottom: '1px solid var(--border)',
              background: 'var(--muted)',
              color: 'var(--muted-foreground)',
            }}
          >
            <strong style={{ color: 'var(--foreground)' }}>快速 Agent（悬停）</strong>
            <br />
            悬停即后台思考，满 {(HOVER_REVEAL_MS / 1000).toFixed(1)} 秒显示；离开保留 3 秒。扫射会取消多余请求。
            <br />
            <strong style={{ color: 'var(--foreground)' }}>Agent 助手</strong>
            ：结构化详解 · 思考默认收起；勾选「允许工具」可检索站内文章（ReAct tool-loop）
          </div>
        ) : null}

        <div className="agent-panel-body" style={{ maxHeight: 340, overflowY: 'auto' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 8px', color: 'var(--muted-foreground)' }}>
              <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--foreground)' }}>深度讲解</p>
              <p style={{ fontSize: 12, lineHeight: 1.6, margin: 0 }}>
                悬停知识区内容可快讲；在此输入获取结构化详解。
              </p>
            </div>
          ) : (
            messages.map((m, i) => (
              <div
                key={i}
                style={{
                  marginBottom: 10,
                  padding: '8px 10px',
                  borderRadius: 10,
                  background:
                    m.role === 'user'
                      ? 'var(--muted)'
                      : 'color-mix(in srgb, var(--primary) 8%, var(--card))',
                  fontSize: 13,
                  lineHeight: 1.55,
                }}
              >
                <div
                  style={{
                    font: '700 10px/1 var(--font-mono)',
                    marginBottom: 6,
                    opacity: 0.6,
                  }}
                >
                  {m.role === 'user'
                    ? 'YOU'
                    : m.streaming
                      ? m.text
                        ? 'AGENT · 作答中'
                        : 'AGENT · …'
                      : 'AGENT'}
                </div>
                {m.role === 'assistant' ? (
                  <>
                    <details
                      open={Boolean(m.thinkingOpen)}
                      style={{ marginBottom: 8 }}
                      onToggle={(e) => {
                        const openNow = (e.target as HTMLDetailsElement).open;
                        if (openNow !== Boolean(m.thinkingOpen)) toggleThinking(i);
                      }}
                    >
                      <summary
                        style={{
                          cursor: 'pointer',
                          fontSize: 12,
                          color: 'var(--muted-foreground)',
                          userSelect: 'none',
                        }}
                      >
                        思考过程
                      </summary>
                      {m.thinking ? (
                        <div
                          style={{
                            marginTop: 6,
                            padding: 8,
                            borderRadius: 8,
                            background: 'var(--muted)',
                            fontSize: 11,
                            lineHeight: 1.45,
                            color: 'var(--muted-foreground)',
                            maxHeight: 160,
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                          }}
                        >
                          {m.thinking}
                        </div>
                      ) : m.streaming ? (
                        <div className="agent-thinking-indicator" style={{ marginTop: 6 }}>
                          <span className="agent-thinking-dot" />
                          <span className="agent-thinking-dot" style={{ animationDelay: '0.2s' }} />
                          <span className="agent-thinking-dot" style={{ animationDelay: '0.4s' }} />
                        </div>
                      ) : (
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--muted-foreground)' }}>
                          （无额外推理内容）
                        </div>
                      )}
                    </details>
                    {m.text ? (
                      <MarkdownView source={m.text} compact />
                    ) : m.streaming ? null : (
                      <span style={{ color: 'var(--muted-foreground)' }}>暂无正文</span>
                    )}
                  </>
                ) : (
                  <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                )}
              </div>
            ))
          )}
        </div>
        <div className="agent-panel-input" style={{ flexWrap: 'wrap', gap: 8 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 12,
              color: 'var(--muted-foreground)',
              width: '100%',
              cursor: busy ? 'default' : 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={toolsEnabled}
              disabled={busy}
              onChange={(e) => setToolsEnabled(e.target.checked)}
            />
            允许工具（检索站内文章）
          </label>
          <input
            className="input"
            placeholder={busy ? '生成中…' : '问 Agent 助手…'}
            value={input}
            disabled={busy}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void send();
            }}
            style={{ flex: 1 }}
          />
          <Button disabled={busy || !input.trim()} onClick={() => void send()}>
            发送
          </Button>
        </div>
      </div>
      <button
        type="button"
        className="agent-float-btn"
        aria-label="Agent"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOpen();
        }}
      >
        <span className="agent-float-dot" />
        <span>Agent</span>
      </button>
    </div>
  );
}
