# AgentForge 架构说明

## 概览

Monorepo（npm workspaces）：

| 路径 | 职责 | 状态 |
|------|------|------|
| `apps/web` | Vite + React + TypeScript 读者/作者端 | 已实现 |
| `apps/api` | Express + Prisma + SQLite（默认；可换 PostgreSQL） | 已实现 |
| `packages/shared` | 共享类型与权限矩阵 | 已实现 |
| `services/agent` | 独立 Agent Runtime 占位 | **仅 README，未实现** |
| `services/mcp` | MCP Server 占位 | **仅 README + `GET /api/v1/mcp/status` 探测，未实现** |
| 种子内容 | `apps/api/prisma/seed-content.ts`（`DEFAULT_ARTICLE_SEEDS`） | 已实现 |
| `content/seed` | 预留目录（当前为空） | 占位 |

## 角色与权限

运行时身份：游客 / 读者 / 作者（含 `authorTier=elite` 优秀作者）/ 管理员（`adminLevel` 1–100）。

详见 `docs/identity-permissions.md`。

## 双 Agent 体系（摘要）

| | 悬停 Agent | Agent 面板 |
|--|------------|------------|
| **定位** | 速度优先的即时讲解 | 可对话的助手（**目标为完整智能体**） |
| **当前架构** | 单轮 Fast Direct；流式正文；服务端 `HoverExplainCache` + 前端 L1；记忆只读注入；`extractHoverAnswer` 净化最终输出 | 单轮结构化提示词（`buildDeepSystem`：Thought → Explain → Practice → Next）；会话/消息持久化；滚动摘要；记忆注入；流式正文 + thinking |
| **目标架构** | 保持轻量；扩缓存键、跨设备同步 | **真 tool-loop**（ReAct / Plan-Execute 等）；多轮工具调用；读写记忆；可切换推理模式 |
| **未实现** | 独立悬停会话表、跨设备同步 | 真工具循环；推理模式 UI 切换；面板 UI 模式选择 |

完整说明（Target / Current / 路线图）：**`docs/agent-modes.md`**。

### Agent API 实际路由

`base: /api/v1/agent`，`agentLimiter: 40 req/min`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/meta` | 模式（fast / deep）+ 支持的 API 格式列表 |
| GET | `/providers` | 当前可用 Provider（服务端默认 + BYOK 元数据） |
| POST | `/explain` | 悬停/点击讲解（同步返回） |
| POST | `/explain/stream` | 悬停/点击讲解 SSE 流式 |
| POST | `/chat` | 面板对话（同步返回） |
| POST | `/chat/stream` | 面板对话 SSE 流式 |
| GET | `/memory` | 当前用户 `AgentMemory` 列表 |
| POST | `/memory` | 写入一条 `AgentMemory` |
| POST | `/progress` | 上报某篇文章的学习进度/掌握度 |
| POST | `/cache/clear` | 清空服务端 `HoverExplainCache`（需登录） |
| GET | `/api/v1/mcp/status` | MCP 协议占位探测 |

请求体通过 Zod 校验（`apps/api/src/middleware/validate.ts`）。

### 关键数据模型

实际存在于 `apps/api/prisma/schema.prisma`：

- `User`（含 `role`、`authorTier`、`adminLevel`、`allowAgentAnnotationReview`、`preferences`）
- `Domain`（领域；`agent | llm` 两个 track）
- `Article` / `AnimationDef` / `ArticleAnimation`
- `AgentConversation` / `AgentMessage`（面板会话与消息）
- `AgentMemory`（事实 / 技能 / 偏好 / 摘要）
- `LearningProgress`（`not_started | learning | mastered`）
- `HoverExplainCache`（悬停服务端 L2 缓存）
- `Topic` / `TopicReply`（社区话题）
- `AuthorApplication`（`author | elite` 两种申请）
- `Annotation`（模型已建立，**尚无 API 路由**，等工具循环与审核流时再启用）

## 前端结构（Web）

实际目录（`apps/web/src/`）：

- `app/router.tsx` — `createBrowserRouter` 路由表
- `pages/` — 路由页面
  - 读者：`HomePage` / `KnowledgeOverviewPage` / `ArticlePage` / `LlmOverviewPage` / `DomainDetailPage` / `SearchPage` / `NewsPage` / `TopicsPage` / `TopicNewPage` / `TopicDetailPage`
  - 账户：`LoginPage` / `RegisterPage` / `ProfilePage` / `SettingsPage`
  - 作者：`author/AuthorDashboard` / `author/ArticleEditorPage` / `author/AnimationEditorPage` / `author/ApplyAuthorPage` / `author/ApplicationsAdminPage`
  - 管理：`admin/DomainsAdminPage`
- `components/`
  - `agent/` — `AgentFloat`（面板 + 文章内悬停气泡）、`MarkdownView`（消息体渲染）、`hoverTarget`（悬停挂载）
  - `article/` — `ArticleLayout` / `TableOfContents` / `ArticleBody` / `ArticleCardInlineAgent`
  - `anim/` — `AnimationViewer` + `AnimationControls` + `core/{types, buildScene}` + `primitives/{SceneCanvas, layoutMath}` + `templates/defaultSteps` + `anim-engine.css`
  - `domain/` — `DomainSection`
  - `home/` — `HomeHeroAnim`
  - `layout/` — `AppShell`（顶部、主题色、深浅色）
  - `ui/` — `Button` / `Input` / `Tag`
- `hooks/` — `useAuth` / `useTheme` / `useAnimationPlayer`
- `lib/` — `api` / `apiToken` / `agentStream` / `hoverExplainCache` / `markdown` / `cardExpandLock`
- `styles/` — `tokens.css` / `global.css`

## 安全要点

见 `docs/security.md`（限流、JWT、BYOK、Markdown 消毒、统一错误体等）。

## 本地开发

```bash
npm install
cd apps/api && npx prisma db push && npm run db:seed
npm run dev:api   # :3001
npm run dev:web   # :5280（避免与常见 5173 冲突）
```

浏览器：**http://localhost:5280**
默认管理员：`apps/api/.env` 中 `SEED_ADMIN_*`（默认 `admin@agentforge.local` / `ChangeMe_Admin_123!`）。