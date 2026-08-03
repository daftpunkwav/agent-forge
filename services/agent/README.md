# Agent 服务（独立 Runtime 预留）

本目录预留给未来将 Agent Runtime 从 `apps/api` 拆出的独立进程。

## 当前状态（以代码为准）

站内双 Agent **已在 `apps/api` 实现**，不是 501 占位：

| 能力 | 位置 |
|------|------|
| 悬停讲解 | `POST /api/v1/agent/explain` · `/explain/stream` |
| 面板对话 | `POST /api/v1/agent/chat` · `/chat/stream` |
| 记忆 / 进度 | `GET|POST /memory` · `POST /progress` |
| 悬停 L2 缓存清理 | `POST /cache/clear`（admin） |
| Prompt / Provider | `apps/api/src/lib/llm/` |
| 净化逻辑 | `@agentforge/shared`（`hoverSanitize`） |

**尚未实现**：真实 tool-loop、推理模式切换 UI、本目录独立进程。

产品目标与路线图见 `docs/agent-modes.md`。成熟后再将编排层迁入本服务，并对前端保持现有 SSE 契约。
