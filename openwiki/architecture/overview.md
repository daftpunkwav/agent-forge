---
type: 架构导览
title: 总体架构与 Monorepo 结构
description: Grimoire / AgentForge 的 monorepo 组成、运行时拓扑、构建启动顺序与决策标记约定。
tags: [architecture, monorepo, overview]
---

# 总体架构（Grimoire / AgentForge）

交互式 Agent / LLM 学习平台：富文本教程 + 可分步动画 + 双 Agent（悬停快讲 + 面板对话，含 ReAct tool-loop）。

技术栈：`apps/web`（Vite 8 + React 19）、`services/api`（Express 5 组合根 + Prisma 6 + SQLite）、`@core/contracts`（DTO/权限/端口）、`@core/foundation`（JWT/BYOK/SSE/中间件）、域服务 `services/{identity,content,community,agent,llm}`。

## Monorepo 结构

| 路径 | 职责 | 状态 |
|------|------|------|
| `apps/web` | 读者/作者/管理 SPA | 已实现 |
| `services/api` | **组合根宿主**：装配各域 Router、Prisma、健康检查 | 已实现 |
| `services/identity` | 认证、用户设置、BYOK、作者申请 | 已实现 |
| `services/content` | 文章、域、动画、批注 | 已实现 |
| `services/community` | 话题与回复 | 已实现 |
| `services/agent` | Agent runtime、悬停/对话路由、记忆 | 已实现 |
| `services/llm` | LLM 网关与多 Provider 适配 | 已实现 |
| `packages/contracts` | 共享 DTO、权限矩阵、端口类型、悬停净化 | 已实现 |
| `packages/foundation` | 基础设施（无业务域逻辑） | 已实现 |
| `services/mcp` | MCP Server 预留 | 仅占位 |
| `apps/desktop` / `apps/mobile` | 客户端预留 | 仅占位 |

npm workspaces：根 `package.json` 声明 `apps/*`、`packages/*`、`services/*`。域服务之间**禁止**直接 import（见 `scripts/check-domain-boundaries.mjs`）；跨域装配仅在 `services/api/src/compose.ts`。

## 运行时拓扑

```text
flowchart LR
    B["浏览器 SPA<br/>apps/web :8180"] -->|"/api 代理"| A["组合根 API<br/>services/api :8181"]
    A --> ID[identity]
    A --> CT[content]
    A --> CM[community]
    A --> AG[agent]
    A --> LLM[llm]
    A --> P[(Prisma/SQLite)]
    LLM -->|"BYOK 或服务端 Key"| UP[LLM Provider]
```

- Web 默认 **8180**（`VITE_PORT`），`host: 127.0.0.1`；Vite 将 `/api` 代理到 `8181`（见 `apps/web/vite.config.ts`）。
- API 默认 **8181**（`PORT`）；`GET /health` 返回 `{ ok: true, service: 'api' }`。
- CORS：`CORS_ORIGIN` 逗号分隔，默认含 `http://localhost:8180`。
- `TRUST_PROXY=1` 时才信任反向代理第一跳。

## 构建与启动

```bash
npm install
cp .env.example services/api/.env   # JWT_SECRET、SEED_ADMIN_PASSWORD 等
cd services/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev                         # 同时启动 web:8180 + api:8181
npm run build                       # contracts → foundation → 各 service → api → web
npm test                            # 域边界扫描 + 各 workspace Vitest
```

依赖：`apps/web` 仅依赖 `@core/contracts`（类型）；后端各域依赖 `@core/contracts` + `@core/foundation`；组合根 `services/api` 装配全部域包。

## 决策标记（源码注释）

`services/agent`、`services/llm` 等源码中的 `A-`/`B-`/`C-`/`R-` 前缀为跨变更面索引，改动相关逻辑时请先 grep 对应标记。

## 文档与 review 快照

- 权威设计：根目录 `docs/`、`openwiki/`
- 历史 review：`docs/reviews/`（一次性快照，**以源码与测试为准**）
