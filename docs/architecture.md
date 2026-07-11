# AgentForge 架构说明

## 概览

Monorepo（npm workspaces）：

| 路径 | 职责 |
|------|------|
| `apps/web` | Vite + React + TypeScript 读者/作者端 |
| `apps/api` | Express + Prisma + SQLite（可换 PostgreSQL） |
| `packages/shared` | 共享类型、权限矩阵 |
| `services/agent` | **目标**：面板完整 Agent Runtime（工具循环）独立进程占位 |
| `services/mcp` | **目标**：MCP Server，对外暴露站内检索等工具 |
| 种子内容 | `apps/api/prisma/seed-content.ts` |

## 角色与权限

运行时身份：游客 / 读者 / 作者（含优秀作者 tier）/ 管理员（adminLevel）。  
详见 `docs/identity-permissions.md`。

## 双 Agent 体系（摘要）

| | 悬停 Agent | Agent 面板 |
|--|------------|------------|
| **定位** | 速度优先的即时讲解 | **完整智能体**（上下文 + 工具 + 记忆 + 推理模式） |
| **目标架构** | 单轮 Fast Direct；读记忆；强缓存 | 真 tool-loop（ReAct 等）；多轮会话；读写记忆 |
| **当前** | 已实现单轮流式 + 记忆注入 + 缓存 | 会话/记忆已有；**工具循环待建** |

完整说明（Target / Current / 路线图）：**`docs/agent-modes.md`**。

### API 面（Agent）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/agent/explain`、`/explain/stream` | 悬停/点击讲解 |
| POST | `/api/v1/agent/chat`、`/chat/stream` | 面板对话（目标扩展为 tool-loop） |
| GET/POST | `/api/v1/agent/memory` | 长期记忆 |
| POST | `/api/v1/agent/progress` | 学习进度 |
| GET | `/api/v1/mcp/status` | MCP 预留探测 |

### 关键数据模型

- `User` / 角色与资料  
- `Article` / `Domain` / `AnimationDef`  
- `AgentConversation` / `AgentMessage` — 面板会话  
- `AgentMemory` / `LearningProgress` — 记忆与学习状态  
- `HoverExplainCache` — 悬停结果服务端缓存  
- `Topic` / `TopicReply` — 社区话题  

## 前端结构（Web）

- 路由：`apps/web/src/app/router.tsx`  
- 壳层：`AppShell`（搜索、主题色、深浅色）  
- Agent UI：`AgentFloat`（面板 + 文章内悬停气泡）  
- 卡片行内 Agent：`ArticleCardInlineAgent`  
- 动画：`AnimationViewer` + `SceneCanvas`  

## 安全要点

见 `docs/security.md`（限流、JWT、BYOK、工具校验等）。

## 本地开发

```bash
npm install
cd apps/api && npx prisma db push && npm run db:seed
npm run dev:api   # :3001
npm run dev:web   # :5280（避免与常见 5173 冲突）
```

浏览器：**http://localhost:5280**  
默认管理员：`.env.example` 中 `SEED_ADMIN_*`。
