# AgentForge — Agent 锻造坊

交互式 Agent / LLM 学习平台：富文本教程、可分步动画、读者与作者双端。

## 技术栈

| 层 | 技术 |
|----|------|
| Web | Vite · React 19 · TypeScript · React Router |
| API | Express · Prisma · SQLite · JWT · Zod |
| 共享 | `@agentforge/shared`（角色与权限矩阵） |
| LLM | Anthropic Messages · OpenAI Chat · OpenAI Responses（BYOK + 服务端默认 Provider） |

## 快速开始

```bash
npm install

# 数据库与种子（富文本 + 动画）
cd apps/api
npx prisma db push
npm run db:seed
cd ../..

# 两个终端
npm run dev:api
npm run dev:web
```

- 站点：http://localhost:5280 （固定端口，避免与其它 Vite 项目的 5173 冲突）
- API：http://localhost:3001/health
- 默认 CORS：`http://localhost:5173`（见 `apps/api/src/app.ts`）

默认管理员（可在 `apps/api/.env` 修改，对应变量 `SEED_ADMIN_*`）：

- 邮箱：`admin@agentforge.local`
- 密码：`ChangeMe_Admin_123!`
- 角色：`admin`、`adminLevel=100`、`authorTier=elite`

## 功能

- **读者**：首页、知识/LLM 文章、话题（发帖/回复）、悬停快讲与行内卡片 Agent、登录注册、个人主页、设置（BYOK）、申请成为作者
- **作者**：工作台、Markdown 编辑、动画模板编辑（参数化，非自由画布）、发布
- **管理**：领域管理（增删改）、作者申请审批（分级 `adminLevel`）
- **双 Agent**（详见 `docs/agent-modes.md`）
  - **悬停 Agent**：单轮 Fast Direct；流式正文；服务端 `HoverExplainCache`（L2）+ 前端 L1；`extractHoverAnswer` 净化最终输出；记忆只读注入
  - **Agent 面板**：`/agent/chat`、`/chat/stream`，单轮结构化提示词（Thought → Explain → Practice → Next）；会话与消息持久化、滚动摘要；记忆注入；**尚未实现真工具循环（tool-loop），也未提供推理模式切换 UI**
- **预留**：`services/mcp`（仅 `GET /api/v1/mcp/status` 探测）、`services/agent`（仅 README 占位，独立 Agent Runtime 未实现）

## 目录

```
apps/web                前端（Vite + React + TS）
  src/
    app/router.tsx      路由表
    pages/              路由页面（reader/admin/author）
    components/         agent / anim / article / domain / home / layout / ui
    hooks/              useAuth / useTheme / useAnimationPlayer
    lib/                api / apiToken / agentStream / hoverExplainCache /
                        markdown / cardExpandLock
apps/api                后端（Express + Prisma）
  src/
    routes/             auth, articles, animations, applications,
                        agent, domains, settings, topics
    middleware/         auth, validate, errorHandler
    lib/                prisma, jwt, hash, errors, params,
                        llm/ (agentPrompt, providers, types)
    services/           serialize（DTO 映射）
  prisma/               schema.prisma · seed.ts · seed-content.ts · dev.db
packages/shared         共享 DTO 与权限矩阵（roles/permissions）
content/seed            种子文章资源（目前为空，文章写在 seed-content.ts）
services/agent          仅 README，独立 Agent Runtime 占位（未实现）
services/mcp            仅 README + 状态探测接口占位（未实现）
docs/                   architecture / agent-modes / animation-system /
                        identity-permissions / security
```

详见 `docs/architecture.md`、`docs/agent-modes.md`、`docs/dev-progress.md`、`PLAN.md`。
