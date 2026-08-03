import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { streamAgent, type StreamEvent } from '@/lib/agentStream';
import { getGuestKey, setGuestKey } from '@/lib/guestKey';

export type ChatMsg = {
  role: 'user' | 'assistant';
  text: string;
  thinking?: string;
  streaming?: boolean;
  /** 是否展开思考区（默认收起） */
  thinkingOpen?: boolean;
};

type PanelStreamOpts = {
  onMeta?: (ev: StreamEvent & { type: 'meta' }) => void;
  onPatch: (patch: Partial<ChatMsg>) => void;
  fallback?: () => Promise<string>;
  errorLabel: string;
  /** tool-loop 时拉长 SSE 超时 */
  timeoutMs?: number;
};

function toolStatusLine(name: string): string {
  if (name === 'search_articles') return '_正在检索文章…_';
  if (name === 'get_article') return '_正在读取文章…_';
  return `_正在调用工具 ${name}…_`;
}

/**
 * Agent 面板会话：消息列表 + deepExplain / send 流式公共流程。
 * 与悬停逻辑解耦；AgentFloat 只负责壳与悬停。
 */
export function useAgentPanel(opts: { style: string; route: string }) {
  const { style, route } = opts;
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  /** 勾选后 chat 走 reasoningMode=react（真 tool-loop） */
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const chatAbortRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
    },
    [],
  );

  const patchLastAssistant = useCallback((patch: Partial<ChatMsg>) => {
    setMessages((m) => {
      const copy = [...m];
      const last = copy[copy.length - 1];
      if (last?.role === 'assistant') {
        copy[copy.length - 1] = { ...last, ...patch };
      }
      return copy;
    });
  }, []);

  const runPanelStream = useCallback(
    async (
      path: '/agent/explain/stream' | '/agent/chat/stream',
      body: unknown,
      streamOpts: PanelStreamOpts,
    ) => {
      let answer = '';
      let thinking = '';
      chatAbortRef.current?.abort();
      const ac = new AbortController();
      chatAbortRef.current = ac;
      try {
        await streamAgent(
          path,
          body,
          (ev) => {
            if (ev.type === 'meta') {
              streamOpts.onMeta?.(ev as StreamEvent & { type: 'meta' });
              return;
            }
            if (ev.type === 'tool_call') {
              const line = toolStatusLine(ev.name);
              answer = answer ? `${answer}\n\n${line}` : line;
              streamOpts.onPatch({ text: answer, streaming: true });
              return;
            }
            if (ev.type === 'tool_result') {
              // 结果已由服务端注入 Observation；前端仅保留简短状态即可
              return;
            }
            if (ev.type === 'thinking' && ev.text) {
              thinking += ev.text;
              streamOpts.onPatch({ thinking, streaming: true, thinkingOpen: false });
            }
            if (ev.type === 'delta' && ev.text) {
              // tool-loop 最终答案常整段 delta：若已有工具状态行，换行追加
              if (answer && /正在(检索|读取|调用)/.test(answer) && !answer.includes(ev.text)) {
                answer = `${answer}\n\n${ev.text}`;
              } else {
                answer += ev.text;
              }
              streamOpts.onPatch({ text: answer, streaming: true });
            }
            if (ev.type === 'final') {
              if (ev.answer != null) answer = ev.answer;
              if (ev.thinking != null) thinking = ev.thinking;
              streamOpts.onPatch({ text: answer, thinking, streaming: false, thinkingOpen: false });
            }
            if (ev.type === 'error') {
              answer = `**错误**\n\n${ev.message}`;
            }
          },
          ac.signal,
          { timeoutMs: streamOpts.timeoutMs },
        );
        if (!answer.trim() && streamOpts.fallback) {
          try {
            answer = (await streamOpts.fallback()) || '';
          } catch {
            /* keep */
          }
        }
        streamOpts.onPatch({
          text: answer.trim() || '**暂无输出**\n\n请检查 BYOK 配置后重试。',
          thinking,
          streaming: false,
          thinkingOpen: false,
        });
      } catch (err) {
        if ((err as Error).name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : streamOpts.errorLabel;
        streamOpts.onPatch({ text: `**错误**\n\n${msg}`, streaming: false });
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const deepExplain = useCallback(
    async (text: string, title?: string, articleSlug?: string) => {
      setBusy(true);
      const userLine = `请详细讲解：${title || text.slice(0, 80)}`;
      setMessages((m) => [
        ...m,
        { role: 'user', text: userLine },
        { role: 'assistant', text: '', thinking: '', streaming: true, thinkingOpen: false },
      ]);
      await runPanelStream(
        '/agent/explain/stream',
        {
          mode: 'click',
          style,
          selection: {
            text: text.slice(0, 3500),
            title,
            articleSlug,
            route,
          },
        },
        {
          onPatch: patchLastAssistant,
          errorLabel: '讲解失败',
          fallback: () =>
            api
              .agentExplain({
                mode: 'click',
                style,
                selection: {
                  text: text.slice(0, 3500),
                  title,
                  articleSlug,
                  route,
                },
              })
              .then((r) => r.explanation || ''),
        },
      );
    },
    [style, route, runPanelStream, patchLastAssistant],
  );

  const send = useCallback(async () => {
    if (!input.trim() || busy) return;
    const msg = input.trim();
    setInput('');
    setBusy(true);
    setMessages((m) => [
      ...m,
      { role: 'user', text: msg },
      { role: 'assistant', text: '', thinking: '', streaming: true, thinkingOpen: false },
    ]);
    const chatBody = {
      message: msg,
      style,
      mode: 'deep' as const,
      conversationId: conversationIdRef.current || undefined,
      guestKey: getGuestKey(),
      context: { route },
      ...(toolsEnabled ? { reasoningMode: 'react' as const } : {}),
    };
    await runPanelStream('/agent/chat/stream', chatBody, {
      onPatch: patchLastAssistant,
      errorLabel: '发送失败',
      timeoutMs: toolsEnabled ? 90_000 : undefined,
      onMeta: (ev) => {
        if (ev.conversationId) conversationIdRef.current = ev.conversationId;
        if (ev.guestKey) setGuestKey(ev.guestKey);
      },
      fallback: () =>
        api.agentChat(chatBody).then((r) => {
          if (r.conversationId) conversationIdRef.current = r.conversationId;
          if (r.guestKey) setGuestKey(r.guestKey);
          return r.reply || '';
        }),
    });
  }, [input, busy, style, route, toolsEnabled, runPanelStream, patchLastAssistant]);

  const toggleThinking = useCallback((index: number) => {
    setMessages((m) =>
      m.map((msg, i) =>
        i === index && msg.role === 'assistant'
          ? { ...msg, thinkingOpen: !msg.thinkingOpen }
          : msg,
      ),
    );
  }, []);

  return {
    messages,
    setMessages,
    input,
    setInput,
    busy,
    setBusy,
    toolsEnabled,
    setToolsEnabled,
    deepExplain,
    send,
    toggleThinking,
  };
}
