# Grimoire 架构说明

> 最后核对：2026-08-04（以仓库代码为准）

## 概览

Monorepo（npm workspaces：`apps/*`、`packages/*`）：

| 路径 | 职责 | 状态 |
|------|------|------|
| `apps/web` | Vite 8 + React 19 + TypeScript 读者/作者端 | 已实现 |
| `apps/api` | Express 5 + Prisma 6 + SQLite（可换 PostgreSQL） | 已实现 |
| `packages/shared` | 共享类型、权限矩阵、悬停答案净化 | 已实现 |
| `services/agent` | 独立 Agent Runtime 拆分预留 | **仅 README**；站内 Agent 已在 `apps/api` |
| `services/mcp` | MCP Server 预留 | **仅 README + `GET /api/v1/mcp/status`** |
| 种子内容 | `apps/api/prisma/seed-content.ts`（`DEFAULT_ARTICLE_SEEDS`，20 篇 + 5 个领域） | 已实现 |
| `_legacy/` | 旧静态站归档（已停维护） | 已迁入；`.gitignore` 已忽略（46 文件历史已纳入 git 跟踪，新内容不会再进 git） |

根目录若存在空壳 `api/`，以 `apps/api` 为准，勿混用。

## 角色与权限

运行时身份：游客 / 读者 / 作者（含 `authorTier=elite`）/ 管理员（`adminLevel` 1–100）。

认证：Bearer JWT **access**（默认 `15m`，`JWT_ACCESS_EXPIRES_IN` 可改）+ **refresh**（默认 `7d`，`JWT_REFRESH_EXPIRES_IN` 可改，DB 仅存 sha256 hash，旋转吊销）；payload 含 `sub / email / role / authorTier / adminLevel`。  
Refresh/access 目前仍存前端 localStorage；HttpOnly Cookie 迁移见 **`docs/roadmap/httponly-cookie-migration.md`**。

详见 `docs/architecture/identity-permissions.md`、`docs/architecture/security.md`。

## 双 Agent 体系（摘要）

| | 悬停 Agent | Agent 面板 |
|--|------------|------------|
| **定位** | 速度优先的即时讲解 | 可对话的助手（**目标为完整智能体**） |
| **当前架构** | 单轮 Fast Direct；流式正文；L2 `HoverExplainCache`（键前缀 `v7`）+ 前端 L1；记忆只读注入；净化在 `@core/contracts` | 会话/消息持久化；滚动摘要；记忆注入；流式 thinking + 正文；**P0 tool-loop**（`search_articles` / `get_article`，勾选「允许工具」） |
| **目标架构** | 保持轻量；扩缓存键、跨设备同步 | 更多工具 / MCP；完整模式 UI；读写记忆确认 |
| **未实现** | 独立悬停会话表、跨设备同步 | P1/P2 见 **`docs/roadmap/tool-loop-roadmap.md`** |

完整说明：**`docs/architecture/agent-modes.md`**。

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

`apps/api/prisma/schema.prisma`（15 个模型）：

- `User`（`role`、`authorTier`、`adminLevel`、`allowAgentAnnotationReview`、`preferences`）
- `RefreshToken`（refresh 旋转/吊销，存 sha256）
- `Domain`（`agent | llm` track）
- `Article` / `AnimationDef` / `ArticleAnimation`
- `AgentConversation` / `AgentMessage`（匿名会话 TTL 7 天）
- `AgentMemory` / `LearningProgress` / `HoverExplainCache`
- `Topic` / `TopicReply`
- `AuthorApplication`（`author | elite`）
- `Annotation`（GET/POST/PATCH 见 `/api/v1/annotations`）

## 前端结构（Web）

`apps/web/src/`：

- `app/router.tsx` — 路由表（约 22 条，含 404）
- `pages/` — 读者 / 账户 / `author/*` / `admin/DomainsAdminPage`
- `components/`
  - `agent/` — `AgentFloat`、`MarkdownView`、`hoverTarget`
  - `article/` — `ArticleLayout` / `TableOfContents` / `ArticleBody` / `ArticleCardInlineAgent`
  - `anim/` — `AnimationViewer` + `core/` + `primitives/` + `templates/`
  - `domain/` · `home/` · `layout/AppShell` · `ui/`
- `hooks/` — `useAuth` / `useTheme` / `useAnimationPlayer` / `useAgentPanel` / `useAgentStyle`
- `lib/` — `api` / `apiToken` / `agentStream` / `hoverExplainCache` / `hoverExplainSession` / `hoverStreamBuffer` / `markdown` / `cardExpandLock` / `guestKey`
- `styles/` — `tokens.css` / `global.css`

Vite：端口 **8180**、`host: 127.0.0.1`、`/api` 代理到 `8181`。

## 后端结构（API）

- 路由：`auth` · `articles` · `animations` · `applications` · `domains` · `settings` · `topics` · `agent` · `annotations`
- 中间件：`optionalAuth` / `requireAuth` / `requireRole` / `requirePermission` / `requireAdminLevel`；Zod `validate`；统一 `errorHandler`
- LLM：`providers.ts`（三种 API 格式 + BYOK，调用委托 `adapters/`）；`agentPrompt.ts`（Prompt + 复用 shared 净化）；`tools/`（P0 tool-loop 最小集：`search_articles` / `get_article`）
- 服务：`services/agentOrchestrator.ts`（讲解/对话编排）、`services/agentConversation.ts`（会话/摘要/匿名 TTL）、`services/agentMemory.ts`（记忆/BYOK/话题）、`services/hoverCache.ts`（L2 缓存 v7）、`services/annotationAcl.ts`（批注可见性/审核）、`services/serialize.ts`（DTO）
- 日志：`lib/logger.ts`（Pino；开发 pino-pretty）

## 安全要点

见 `docs/architecture/security.md`（限流、JWT、BYOK、Markdown 消毒、统一错误体等）。

## 本地开发

```bash
npm install
# 配置 apps/api/.env（见仓库根 .env.example）
cd apps/api && npx prisma db push && npm run db:seed
npm run dev:api     # :8181（含 /docs Swagger UI）
npm run dev:web     # :8180
```

浏览器：http://localhost:8180  
API 文档：http://localhost:8181/docs（开发环境自动挂载，zod-to-openapi 生成）  
管理员密码：仅来自 `SEED_ADMIN_PASSWORD`，**无文档/代码内置兜底口令**。

> 端口编号规则：**8180** 前端 · **8181** API（含 `/docs`）；后续新增服务依次顺延 **8182、8183、8184**…
>
> **默认端口零配置**：clone 后无 `.env` 时自动使用 8180/8181（`index.ts` 兜底 `PORT||8181`、vite 固定 8180）。
>
> **显式指定端口**（端口被占用不自动顺延，启动前友好提示 + 换端口命令）：
> ```bash
> VITE_PORT=8182 npm run dev:web      # 前端
> PORT=8182 npm run dev:api           # API
> VITE_API_PORT=8182 npm run dev:web  # API 非默认端口时前端代理指向
> ```
>
> **CORS**：开发模式自动放行本机任意端口（`localhost`/`127.0.0.1`），自定义前端端口无需改配置；生产仅 `CORS_ORIGIN` 白名单（生产必填，`validateEnv` fail-fast）——`src/lib/corsPolicy.ts`。
>
> **绑定地址**：API 默认仅 `127.0.0.1`（开发不暴露局域网）；`HOST=0.0.0.0` 显式放开（容器/反代后）——生产部署见 `docs/operations/deployment.md`。
