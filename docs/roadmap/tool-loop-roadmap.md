# 待办：Tool-loop 深化与 MCP

> 状态：**P0 已完成；P1/P2 未实现**（2026-08-04）  
> 相关：`docs/architecture/agent-modes.md` · `docs/architecture/security.md` · `apps/api/src/lib/llm/tools/` · `services/mcp/`

## 当前（P0）

已落地最小真 tool-loop：

| 能力 | 说明 |
|------|------|
| 工具 | `search_articles`、`get_article` |
| 触发 | 面板「允许工具」→ `reasoningMode: 'react'`（或 `toolsEnabled: true`） |
| 护栏 | 白名单、Zod 参数、每工具 8s 超时、默认最多 5 轮、pino 审计 |
| 传输 | SSE `tool_call` / `tool_result` |
| 实现 | prompt-based `TOOL_CALL:`（跨 Provider），非原生 function-calling |

## 未完成：P1 — 更多站内工具与体验

| 项 | 说明 |
|----|------|
| 更多工具 | 建议：`list_domains`、`get_user_progress`、`save_memory`（需写权限与确认 UX）、可选 `search_topics` |
| 模式 UI | 完整推理模式选择器（`react` / `deep_teach` / `socratic` / `chat`），不仅是勾选框 |
| 会话列表 | 多会话切换 UI；与现有 `AgentConversation` 对齐 |
| Observation 注入防御 | 工具返回写入 prompt 前做长度上限、敏感字段剥离、防「工具结果冒充系统指令」 |
| 速率 | tool-loop 单独更严限流（与普通 chat 配额分离） |
| 原生 tools | 在 `openai_chat` 等支持 function-calling 的格式上可选真 tools API，减少解析脆弱性 |

## 未完成：P2 — MCP 对接

| 项 | 说明 |
|----|------|
| 现状 | `GET /api/v1/mcp/status` → `reserved`；`services/mcp` 仅 README |
| 目标 | 独立 MCP Server 进程；Agent Runtime 通过 MCP 暴露/消费工具与资源 |
| 安全 | MCP 工具进白名单或按用户/租户授权；参数校验与超时与站内工具同一套护栏 |
| 拆分 | 长期将编排迁出 `apps/api` 至 `services/agent`（见架构文档预留） |

## 实施顺序建议

1. Observation 注入防御 + tool 专属限流（安全优先）  
2. `list_domains` / `get_user_progress`（只读、低风险）  
3. 模式选择器 UI  
4. `save_memory`（写操作 + 用户确认）  
5. MCP Server 骨架进程 + 与 tool registry 桥接  
6. 可选：Provider 原生 function-calling 适配层  

## 完成定义（Definition of Done）

- [ ] 至少再增加 2 个只读站内工具并有单测  
- [ ] Observation 写入 prompt 有统一消毒/截断  
- [ ] tool-loop 独立 rate limit  
- [ ] MCP：非 `reserved`，至少可列出并调用 1 个受控工具  
- [ ] `docs/architecture/agent-modes.md` / `docs/architecture/security.md` 勾选更新；本文件归档或改为「已完成摘要」
