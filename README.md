# AgentForge — Agent 锻造坊

交互式 Agent / LLM 学习平台：富文本教程、可分步动画、读者与作者双端。

## 技术栈

| 层 | 技术 |
|----|------|
| Web | Vite 8 · React 19 · TypeScript · React Router 7 |
| API | Express 5 · Prisma 6 · SQLite · JWT · Zod · Helmet · Pino |
| 共享 | `@agentforge/shared`（角色权限矩阵 + 悬停答案净化） |
| LLM | Anthropic Messages · OpenAI Chat · OpenAI Responses（BYOK + 服务端默认 Provider，默认 StepFun） |

Node.js ≥ 20；npm workspaces（`apps/*`、`packages/*`）。

## 快速开始

```bash
npm install

# 配置环境变量（至少填 SEED_ADMIN_PASSWORD 与 JWT_SECRET）
cp .env.example apps/api/.env
# 编辑 apps/api/.env：SEED_ADMIN_PASSWORD（≥8 字符，无内置兜底口令）
# 可选：STEPFUN_API_KEY / OPENAI_API_KEY 等 LLM 密钥

# 数据库与种子（富文本 + 动画）
cd apps/api
npx prisma db push
npm run db:seed
cd ../..

# 两个终端
npm run dev:api
npm run dev:web
```

- 站点：http://localhost:5280（固定端口，`strictPort`）
- API：http://localhost:3001/health
- CORS：请在 `apps/api/.env` 设 `CORS_ORIGIN=http://localhost:5280`（与 `.env.example` 一致；代码硬编码默认仍为 `5173`，未配 env 时会不匹配）

默认管理员（由 `SEED_ADMIN_*` 控制）：

- 邮箱：`admin@agentforge.local`（可用 `SEED_ADMIN_EMAIL` 覆盖）
- 密码：**必须**在 env 中设置 `SEED_ADMIN_PASSWORD`（缺失则 seed 拒绝执行）
- 角色：`admin`、`adminLevel=100`、`authorTier=elite`
- 已存在同邮箱用户不自动提权，需 `SEED_FORCE_ADMIN=1`

## 功能

- **读者**：首页、知识/LLM 文章、领域详情、搜索、资讯、话题（发帖/回复）、悬停快讲与行内卡片 Agent、登录注册、个人主页、设置（BYOK）、申请成为作者
- **作者**：工作台、Markdown 编辑、动画模板编辑（参数化，非自由画布）、发布
- **管理**：领域管理（`adminLevel ≥ 50`）、作者申请审批（分级 `adminLevel`）
- **双 Agent**（详见 `docs/agent-modes.md`）
  - **悬停 Agent**：单轮 Fast Direct；流式正文；服务端 `HoverExplainCache`（L2，缓存键 `v7`）+ 前端 L1；净化逻辑在 `@agentforge/shared`；记忆只读注入
  - **Agent 面板**：`/agent/chat`、`/chat/stream`，单轮结构化提示词（Thought → Explain → Practice → Next）；会话与消息持久化、滚动摘要；记忆注入；**尚未实现真工具循环（tool-loop），也未提供推理模式切换 UI**
- **预留**：`services/mcp`（仅 `GET /api/v1/mcp/status` 探测）、`services/agent`（独立 Runtime 未拆分；站内 Agent 已在 `apps/api` 实现）

## 目录

```
apps/web                前端（Vite + React + TS）
  src/
    app/router.tsx      路由表
    pages/              路由页面（读者 / 账户 / author / admin）
    components/         agent / anim / article / domain / home / layout / ui
    hooks/              useAuth / useTheme / useAnimationPlayer
    lib/                api / apiToken / agentStream / hoverExplainCache /
                        markdown / cardExpandLock
apps/api                后端（Express + Prisma）
  src/
    routes/             auth, articles, animations, applications,
                        agent, domains, settings, topics
    middleware/         auth, validate, errorHandler
    lib/                prisma, jwt, hash, errors, params, logger,
                        llm/ (agentPrompt, providers, types)
    services/           serialize（DTO 映射）
  prisma/               schema.prisma · seed.ts · seed-content.ts · dev.db
packages/shared         共享 DTO、权限矩阵、悬停净化（hoverSanitize）
services/agent          独立 Agent Runtime 预留（仅 README；业务在 apps/api）
services/mcp            MCP 预留（仅 README + 状态探测）
_legacy/                旧版静态站归档（已被 .gitignore 忽略）
docs/                   architecture / agent-modes / animation-system /
                        identity-permissions / security / postgres /
                        httponly-cookie-migration / tool-loop-roadmap /
                        dev-progress
                        identity-permissions / security / dev-progress
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev:web` / `dev:api` | 分别启动前端 / API |
| `npm run build` | 构建 shared → web → api |
| `npm run db:seed` | 种子管理员 + 领域 + 文章/动画 |
| `npm test` | API Vitest（悬停净化等） |
| `npm run lint` | 各 workspace oxlint |

详见 `docs/architecture.md`、`docs/agent-modes.md`、`docs/security.md`、`docs/postgres.md`、`docs/dev-progress.md`、`PLAN.md`。
待办深化：`docs/httponly-cookie-migration.md`、`docs/tool-loop-roadmap.md`。
