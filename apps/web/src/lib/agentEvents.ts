/** Agent 面板「深度讲解」自定义事件（跨组件触发面板展开） */
export const AGENT_EXPLAIN_EVENT = 'agent:explain';

export type AgentExplainDetail = {
  text: string;
  title?: string;
  articleSlug?: string;
};

export function dispatchAgentExplain(detail: AgentExplainDetail): void {
  window.dispatchEvent(new CustomEvent(AGENT_EXPLAIN_EVENT, { detail }));
}

export function subscribeAgentExplain(
  handler: (detail: AgentExplainDetail) => void,
): () => void {
  function onExplain(e: Event) {
    const detail = (e as CustomEvent<AgentExplainDetail>).detail;
    if (!detail?.text) return;
    handler(detail);
  }
  window.addEventListener(AGENT_EXPLAIN_EVENT, onExplain);
  return () => window.removeEventListener(AGENT_EXPLAIN_EVENT, onExplain);
}
