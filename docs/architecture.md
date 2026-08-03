# AgentForge 架构说明

> 最后核对：2026-08-03（以仓库代码为准）

## 概览

Monorepo（npm workspaces：`apps/*`、`packages/*`）：

| 路径 | 职责 | 状态 |
|------|------|------|
| `apps/web` | Vite 8 + React 19 + TypeScript 读者/作者端 | 已实现 |
| `apps/api` | Express 5 + Prisma 6 + SQLite（可换 PostgreSQL） | 已实现 |
| `packages/shared` | 共享类型、权限矩阵、悬停答案净化 | 已实现 |
| `services/agent` | 独立 Agent Runtime 拆分预留 | **仅 README**；站内 Agent 已在 `apps/api` |
| `services/mcp` | MCP Server 预留 | **仅 README + `GET /api/v1/mcp/status`** |
| 种子内容 | `apps/api/prisma/seed-content.ts`（`DEFAULT_ARTICLE_SEEDS`，约 21 篇） | 已实现 |
| `_legacy/` | 旧静态站归档 | 已迁入；`.gitignore` 忽略 |

根目录若存在空壳 `api/`，以 `apps/api` 为准，勿混用。

## 角色与权限

运行时身份：游客 / 读者 / 作者（含 `authorTier=elite`）/ 管理员（`adminLevel` 1–100）。

认证：Bearer JWT（**仅 access token**，无 refresh）；payload 含 `sub / email / role / authorTier / adminLevel`。

详见 `docs/identity-permissions.md`。

## 双 Agent 体系（摘要）

| | 悬停 Agent | Agent 面板 |
|--|------------|------------|
| **定位** | 速度优先的即时讲解 | 可对话的助手（**目标为完整智能体**） |
| **当前架构** | 单轮 Fast Direct；流式正文；L2 `HoverExplainCache`（键前缀 `v7`）+ 前端 L1；记忆只读注入；净化在 `@agentforge/shared` | 单轮结构化提示词（Thought → Explain → Practice → Next）；会话/消息持久化；滚动摘要；记忆注入；流式 thinking + 正文 |
| **目标架构** | 保持轻量；扩缓存键、跨设备同步 | **真 tool-loop**；多轮工具调用；读写记忆；可切换推理模式 |
| **未实现** | 独立悬停会话表、跨设备同步 | 真工具循环；推理模式 UI；面板模式选择 |

完整说明：**`docs/agent-modes.md`**。

### Agent API

`base: /api/v1/agent`，`agentLimiter: 40 req/min`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/meta` | 模式（fast / deep）+ 支持的 API 格式 |
| GET | `/providers` | 可用 Provider（服务端默认 + BYOK 元数据） |
| POST | `/explain` | 悬停/点击讲解（同步） |
| POST | `/explain/stream` | 悬停/点击讲解 SSE |
| POST | `/chat` | 面板对话（同步） |
| POST | `/chat/stream` | 面板对话 SSE |
| GET | `/memory` | 当前用户 `AgentMemory`（需登录） |
| POST | `/memory` | 写入记忆（需登录） |
| POST | `/progress` | 学习进度（需登录） |
| POST | `/cache/clear` | 清空 L2 悬停缓存（需 **admin**） |

另：`GET /api/v1/mcp/status` 为 MCP 占位探测。

### 主要数据模型

`apps/api/prisma/schema.prisma`（13 个模型）：

- `User`（`role`、`authorTier`、`adminLevel`、`allowAgentAnnotationReview`、`preferences`）
- `Domain`（`agent | llm` track）
- `Article` / `AnimationDef` / `ArticleAnimation`
- `AgentConversation` / `AgentMessage`（匿名会话 TTL 7 天）
- `AgentMemory` / `LearningProgress` / `HoverExplainCache`
- `Topic` / `TopicReply`
- `AuthorApplication`（`author | elite`）
- `Annotation`（**模型已有，尚无 API 路由**）

## 前端结构（Web）

`apps/web/src/`：

- `app/router.tsx` — 路由表（约 22 条，含 404）
- `pages/` — 读者 / 账户 / `author/*` / `admin/DomainsAdminPage`
- `components/`
  - `agent/` — `AgentFloat`、`MarkdownView`、`hoverTarget`
  - `article/` — `ArticleLayout` / `TableOfContents` / `ArticleBody` / `ArticleCardInlineAgent`
  - `anim/` — `AnimationViewer` + `core/` + `primitives/` + `templates/`
  - `domain/` · `home/` · `layout/AppShell` · `ui/`
- `hooks/` — `useAuth` / `useTheme` / `useAnimationPlayer`
- `lib/` — `api` / `apiToken` / `agentStream` / `hoverExplainCache` / `markdown` / `cardExpandLock`
- `styles/` — `tokens.css` / `global.css`

Vite：端口 **5280**、`host: 127.0.0.1`、`/api` 代理到 `3001`。

## 后端结构（API）

- 路由：`auth` · `articles` · `animations` · `applications` · `domains` · `settings` · `topics` · `agent`
- 中间件：`optionalAuth` / `requireAuth` / `requireRole` / `requirePermission` / `requireAdminLevel`；Zod `validate`；统一 `errorHandler`
- LLM：`providers.ts`（三种 API 格式 + BYOK）；`agentPrompt.ts`（Prompt + 复用 shared 净化）
- 日志：`lib/logger.ts`（Pino；开发 pino-pretty）

## 安全要点

见 `docs/security.md`（限流、JWT、BYOK、Markdown 消毒、统一错误体等）。

## 本地开发

```bash
npm install
# 配置 apps/api/.env（见仓库根 .env.example）
cd apps/api && npx prisma db push && npm run db:seed
npm run dev:api   # :3001
npm run dev:web   # :5280
```

浏览器：http://localhost:5280  
管理员密码：仅来自 `SEED_ADMIN_PASSWORD`，**无文档/代码内置兜底口令**。
