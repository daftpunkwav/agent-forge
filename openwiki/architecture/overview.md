---
type: 架构导览
title: 总体架构与 Monorepo 结构
description: AgentForge 的 monorepo 组成、运行时拓扑、构建启动顺序、docs 目录与决策标记约定；回答「这个仓库是什么、各目录职责、如何运行」。
tags: [architecture, monorepo, overview]
---

# 总体架构（AgentForge）

AgentForge（Agent 锻造坊）是一个交互式 Agent / LLM 学习平台：富文本教程 + 可分步动画，面向读者（学习）、作者（创作）、管理员（治理）三端，并内置「双 Agent」体系（悬停快讲 + 面板对话，含 ReAct tool-loop）。技术栈为 Vite 8 / React 19 / TypeScript（`apps/web`）、Express 5 / Prisma 6 / SQLite（`apps/api`）、`@agentforge/shared`（共享 DTO + 权限矩阵 + 悬停答案净化）。

## Monorepo 结构

| 路径 | 职责 | 状态 |
|------|------|------|
| `apps/web` | 读者/作者/管理 SPA（Vite 8 + React 19 + React Router 7） | 已实现 |
| `apps/api` | REST API + Agent 路由（Express 5 + Prisma 6 + SQLite） | 已实现 |
| `packages/shared` | 共享类型、DTO、权限矩阵、悬停答案净化（前后端共用单一真相） | 已实现 |
| `services/agent` | 独立 Agent Runtime 拆分**预留**（仅 README；站内 Agent 已在 `apps/api` 实现） | 仅 README |
| `services/mcp` | MCP Server **预留**（仅 README + `GET /api/v1/mcp/status` 状态探测） | 仅占位 |
| `docs/` | 权威文档 + 历史 review 快照（见下文「docs 目录与决策记录」） | 参考 |
| `_legacy/` | 旧静态站归档（已被 `.gitignore` 忽略，不再进 git） | 归档 |
| `api/`（根目录） | **空壳目录**（middleware/models/prisma/routes 均为空）——勿使用，一律以 `apps/api` 为准 | 废弃 |

npm workspaces：根 `package.json` 声明 `apps/*` 与 `packages/*`；`@agentforge/shared` 被 `apps/web` 与 `apps/api` 依赖，且发布为编译产物（`dist/`），因此**必须先构建 shared 再构建两端**（`npm run build` 已按此顺序执行）。

## 运行时拓扑

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    B["浏览器 SPA<br/>apps/web :5280"] -->|"/api 代理"| A["Express API<br/>apps/api :3001"]
    B -->|"VITE_API_BASE_URL 直连（可选）"| A
    A --> P[(Prisma/SQLite<br/>dev.db)]
    A -->|"fetch (BYOK 或服务端默认)"| L["LLM Provider<br/>StepFun / OpenAI / Generic"]
    A --> C["HoverExplainCache<br/>L2 服务端缓存 (v7)"]
    B -.->|"L1 浏览器内存缓存"| B
```

- Web 固定端口 **5280**（`strictPort`），`host: 127.0.0.1`，Vite 把 `/api` 代理到 `http://127.0.0.1:3001`（见 `apps/web/vite.config.ts`）。
- API 默认端口 **3001**（`PORT` 可覆盖）；`GET /health` 返回 `{ ok: true, service: 'agentforge-api', ts }`。
- CORS 白名单由 `CORS_ORIGIN` 控制（逗号分隔），默认 `http://localhost:5280`；`TRUST_PROXY=1` 时才信任反向代理第一跳（防伪造 XFF 绕过限流）。
- 生产可切 PostgreSQL（见 [operations/development](../operations/development.md) 与 `docs/postgres.md`；`docker-compose.yml` 提供 postgres:16 容器）。

## 构建与启动顺序

```bash
npm install
cp .env.example apps/api/.env      # 至少填 SEED_ADMIN_PASSWORD 与 JWT_SECRET
cd apps/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev:web                    # :5280
npm run dev:api                    # :3001（另一终端）
npm run build                      # shared → web → api
npm test                           # api Vitest + shared Vitest
```

依赖关系：`apps/api`、`apps/web` → `@agentforge/shared`（dist）；web 通过 `VITE_API_BASE_URL || '/api/v1'` 访问 API。

## 分层地图（本 wiki 导航）

- [架构与安全](../architecture/overview.md) / [数据模型](../architecture/data-model.md) / [安全](../architecture/security.md)
- [后端总览](../backend/overview.md) / [身份与用户](../backend/auth-users.md) / [内容域](../backend/content.md) / [社区域](../backend/community.md) / [设置与 BYOK](../backend/settings-byok.md)
- [Agent 体系总览](../agent/overview.md) / [悬停 Agent](../agent/hover-agent.md) / [面板对话](../agent/chat-panel.md) / [ReAct tool-loop](../agent/tool-loop.md) / [LLM Provider](../agent/llm-providers.md) / [提示词与净化](../agent/prompt-sanitize.md)
- [前端总览](../frontend/overview.md) / [页面清单](../frontend/pages.md) / [Agent UI](../frontend/agent-ui.md) / [动画系统](../frontend/animation-system.md) / [Markdown 管线](../frontend/markdown-pipeline.md)
- [@agentforge/shared](../packages/shared.md) / [开发与运维](../operations/development.md)

## docs 目录与决策记录

`docs/` 分为两类：

1. **权威文档**（wiki 参考并与代码核对）：`architecture.md`、`agent-modes.md`、`security.md`、`identity-permissions.md`、`tool-loop-roadmap.md`、`postgres.md`、`httponly-cookie-migration.md`、`animation-system.md`、`dev-progress.md`。
2. **历史 review 快照**（一次性审计，会过时）：`code-review*.md`、`architecture-review-2026-08-04.md`、`comprehensive-review-*.md`。本 wiki 以源码与测试为准；快照仅作意图参考。

**代码内决策标记约定**：`apps/api` 源码注释中散布 A-/B-/C-/D-/I- 前缀标记，索引重要不变量与变更面，例如：

| 标记 | 含义 | 位置示例 |
|------|------|----------|
| A-01 | LLM 错误信息脱敏：诊断字段只进日志，客户端只见安全文案 | `lib/llm/providerHttp.ts`（LlmCallError）、`routes/agent.ts` SSE error |
| A-02 | 同步/流式 LLM 调用统一超时（30s）；hover 兜底重试 12s | `lib/llm/providerHttp.ts` withTimeout |
| A-03 | BYOK apiKey AES-256-GCM 静态加密，库中不留明文 | `lib/byokCrypto.ts` |
| A-04 | system 规则复述/策划特征门控（isSystemEcho、looksLikeHoverPlanning） | `routes/agent.ts`、`lib/llm/agentPrompt.ts` |
| B-02 / B-05 / B-06 / B-07 / B-08 / B-10 | 同步流式共用语义 / 5xx 重试一次 / 打点可观测性 / 清理节流 / 记忆上限与稳定 key / 单一 res.end | `agentOrchestrator.ts`、`providers.ts`、`agentConversation.ts`、`agentMemory.ts` |
| C-01 / C-02 / C-03 / C-04 / C-06 | 类型化请求体 / 服务拆分 / 参数单一真相来源 / 净化单一真相（shared）/ prefs 单例 | 各拆分点 |
| D-02 / D-03 / D-05 | adapter 行为收敛 / 记忆块总长上限 / 模式命名准确性 | `agentPrompt.ts`、`providers.ts` |
| I2 / I3 / I5 | abort 信号统一挂接 / 仅累积安全思考片段 / 先持久化再发 final/done | `routes/agent.ts` |

> 这些标记是跨系统变更面的速查索引：改动时先 grep 对应标记确认关联不变量。
