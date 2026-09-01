import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAgentStyle } from '@/hooks/useAgentStyle';
import { useAgentPanel } from '@/hooks/useAgentPanel';
import { AgentPanel } from './AgentPanel';
import { HoverTipBubble } from './HoverTipBubble';
import { useHoverAgent } from './useHoverAgent';

/**
 * 快速 Agent（悬停）+ Agent 助手（面板）入口。
 * 悬停逻辑见 useHoverAgent；面板 UI 见 AgentPanel。
 */
export function AgentFloat() {
  const [open, setOpen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const style = useAgentStyle('professional');
  const location = useLocation();
  const {
    messages,
    input,
    setInput,
    busy,
    deepExplain,
    send,
    toggleThinking,
    toolsEnabled,
    setToolsEnabled,
  } = useAgentPanel({ style, route: location.pathname });

  const floatRef = useRef<HTMLDivElement>(null);
  const {
    hoverTip,
    tipBox,
    tipRef,
    tipEntered,
    handleTipMouseEnter,
    handleTipMouseLeave,
  } = useHoverAgent(style, location.pathname);

  useEffect(() => {
    function onExplain(e: Event) {
      const detail = (e as CustomEvent).detail as {
        text: string;
        title?: string;
        articleSlug?: string;
      };
      if (!detail?.text) return;
      setOpen(true);
      void deepExplain(detail.text, detail.title, detail.articleSlug);
    }
    window.addEventListener('agent:explain', onExplain);
    return () => window.removeEventListener('agent:explain', onExplain);
  }, [deepExplain]);

  return (
    <>
      {hoverTip && tipBox ? (
        <HoverTipBubble
          tipRef={tipRef}
          hoverTip={hoverTip}
          tipBox={tipBox}
          tipEntered={tipEntered}
          onMouseEnter={handleTipMouseEnter}
          onMouseLeave={handleTipMouseLeave}
        />
      ) : null}

      <AgentPanel
        open={open}
        onClose={() => setOpen(false)}
        showHelp={showHelp}
        onToggleHelp={() => setShowHelp((v) => !v)}
        messages={messages}
        input={input}
        setInput={setInput}
        busy={busy}
        send={send}
        toggleThinking={toggleThinking}
        toolsEnabled={toolsEnabled}
        setToolsEnabled={setToolsEnabled}
        onToggleOpen={() => setOpen((v) => !v)}
        floatRef={floatRef}
      />
    </>
  );
}
