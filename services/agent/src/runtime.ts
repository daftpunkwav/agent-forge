/**
 * Agent 服务运行时组装——服务内部唯一的组合点。
 * 入参是外部依赖端口(deps,由宿主或未来独立进程提供)；
 * 内部协作者(会话/记忆/缓存/工具循环/编排器)在此按依赖图装配。
 * 未来 agent 独立进程 = 用 HTTP 客户端实现 ports 后调用本函数,服务代码零改动。
 */
import type { AgentDeps } from './ports.js';
import { createAgentConversation } from './services/agentConversation.js';
import { createHoverCache } from './services/hoverCache.js';
import { createAgentMemory } from './services/agentMemory.js';
import { createAgentOrchestrator } from './services/agentOrchestrator.js';
import { createToolRegistry } from './lib/tools/registry.js';
import { createToolLoop } from './lib/tools/toolLoop.js';

export function createAgentRuntime(deps: AgentDeps) {
  const conversation = createAgentConversation(deps.prisma);
  const hoverCache = createHoverCache(deps.prisma);
  const memory = createAgentMemory(deps.prisma, deps.users, deps.articles);
  const toolRegistry = createToolRegistry(deps.articles);
  const toolLoop = createToolLoop(deps.llm, toolRegistry.executeTool);
  const orchestrator = createAgentOrchestrator(deps, {
    conversation,
    hoverCache,
    memory,
    toolLoop,
  });

  return {
    deps,
    conversation,
    hoverCache,
    memory,
    toolRegistry,
    toolLoop,
    orchestrator,
  };
}

export type AgentRuntime = ReturnType<typeof createAgentRuntime>;
