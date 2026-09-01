# Grimoire 架构说明

> 最后核对：2026-08-28（以仓库代码为准）

## 概览

模块化单体（npm workspaces：`apps/*`、`packages/*`、`services/*`）。域间**禁止 import 实现**，只经 `@core/contracts` 的端口与 DTO 通信；唯一组合根是 `services/api`。

| 路径 | 职责 | 状态 |
|------|------|------|
| `apps/web` | Vite 8 + React 19 + TypeScript 读者/作者端（仅依赖 `@core/contracts`） | 已实现 |
| `apps/desktop` / `apps/mobile` | 客户端占位 | 占位 |
| `packages/contracts` | 契约：DTO、权限矩阵、端口、悬停净化 | 已实现 |
| `packages/foundation` | 机制：JWT、错误、SSE、BYOK 加解密、限流中间件 | 已实现 |
| `services/identity` | 认证 / 用户 / 作者申请 / 设置 | 已实现 |
| `services/content` | 文章 / 动画 / 领域 / 批注 | 已实现 |
| `services/community` | 话题论坛（关联文章经 `ArticleQueryPort`） | 已实现 |
| `services/agent` | 悬停/面板 Agent、记忆、tool-loop、学习进度 | 已实现 |
| `services/llm` | 无状态 LLM 网关（密钥只在此解密） | 已实现 |
| `services/api` | 宿主组合根：Express 装配、Prisma schema、健康检查 | 已实现 |
| `services/mcp` | MCP Server 预留 | **仅 README + `GET /api/v1/mcp/status`** |
| 种子内容 | `services/api/prisma/seed-content.ts` | 已实现 |

CI：`node scripts/check-domain-boundaries.mjs` 扫描跨服务 import 与他域 `prisma.<model>`。

## 依赖矩阵（允许方向）

```
apps/web            → @core/contracts
packages/foundation → @core/contracts
services/*          → contracts + foundation + 本域表
services/api        → 全部（组合根，唯一允许）
```

禁止：服务间 import 实现、服务读写他域表、前端 import 任何服务或 foundation。

跨域文章引用（`Topic.articleId`、`LearningProgress.articleId`）只存 ID、无 FK；存在性经 `ArticleQueryPort` 校验。`Annotation.articleId` 仍为本域 FK（content 内部）。

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

`services/api/prisma/schema.prisma`（15 个模型，按域分组注释）：

- identity：`User`、`RefreshToken`、`AuthorApplication`
- content：`Domain`、`Article`、`AnimationDef`、`ArticleAnimation`、`Annotation`
- community：`Topic`、`TopicReply`
- agent：`AgentConversation`、`AgentMessage`、`AgentMemory`、`LearningProgress`、`HoverExplainCache`

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

## 后端结构（组合根 + 域服务）

- 组合根：`services/api/src/compose.ts` 注入 ports，按前缀挂载各域 Router；`app.ts` 只做限流/健康/CORS
- identity：`routes/auth` · `settings` · `applications`
- content：`routes/articles` · `animations` · `domains` · `annotations`
- community：`routes/topics`（文章经 `ArticleQueryPort`）
- agent：`routes/agent` + `services/agentOrchestrator` / `agentConversation` / `agentMemory` / `hoverCache` / `learningProgress`
- llm：`providers.ts` + `adapters/`（三种 API 格式；BYOK 密文在 `byokToProvider` 内解密）
- 机制：`@core/foundation`（JWT、errorHandler、SSE、BYOK 加解密）
- 中间件：`optionalAuth` / `requireAuth` / `requireRole` / `requirePermission`；Zod `validate`

## 安全要点

见 `docs/architecture/security.md`（限流、JWT、BYOK、Markdown 消毒、统一错误体等）。

## 本地开发

```bash
npm install
# 配置 services/api/.env（见仓库根 .env.example）
cd services/api && npx prisma db push && npm run db:seed
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
