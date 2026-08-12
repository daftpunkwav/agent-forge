# Grimoire —— 交互式 Agent / LLM 学习平台

交互式 Agent / LLM 学习平台：富文本教程、可分步动画、读者与作者双端。

## 技术栈

| 层 | 技术 |
|----|------|
| Web | Vite 8 · React 19 · TypeScript · React Router 7 |
| API | Express 5 · Prisma 6 · SQLite · JWT · Zod · Helmet · Pino |
| 共享 | `@core/contracts`（角色权限矩阵 + 悬停答案净化）+ `@core/foundation`（基础设施） |
| LLM | Anthropic Messages · OpenAI Chat · OpenAI Responses（BYOK + 服务端默认 Provider，默认 StepFun） |

Node.js ≥ 20；npm workspaces（`apps/*`、`packages/*`、`services/*`）。

## 快速开始

```bash
npm install

# 配置环境变量（至少填 SEED_ADMIN_PASSWORD 与 JWT_SECRET）
cp .env.example services/api/.env
# 编辑 services/api/.env：SEED_ADMIN_PASSWORD（≥8 字符，无内置兜底口令）
# 可选：STEPFUN_API_KEY / OPENAI_API_KEY 等 LLM 密钥

# 数据库与种子（富文本 + 动画；schema 在 services/api/prisma）
cd services/api
npx prisma db push
npm run db:seed
cd ../..

# 同时启动前后端（推荐）
npm run dev
```

- 站点：http://localhost:8180（固定端口，`strictPort`）
- API：http://localhost:8181/health
- API 文档（Swagger UI）：http://localhost:8181/docs（开发环境自动挂载，由 `zod-to-openapi` 从路由 schema 生成）
- 端口编号规则：**8180** 前端 · **8181** API（含 `/docs`）；后续新增服务按 **8182、8183、8184**… 依次顺延
- **默认端口零配置**：clone 后无 `.env` 时自动使用 8180/8181；端口被占用时**不自动顺延**，会提示并退出

### 显式指定端口

```bash
# 同时指定前后端
VITE_PORT=5555 PORT=3333 npm run dev
# 只改前端（后端仍为 8181）
VITE_PORT=5555 npm run dev
# 只改后端（前端仍为 8180，代理自动指向 3333）
PORT=3333 npm run dev

# 如需单独启动
npm run dev:web   # 前端
npm run dev:api   # 后端
```

- `VITE_PORT`：前端端口（默认 8180）
- `PORT`：后端端口（默认 8181）；设 `PORT` 时前端 `/api` 代理会自动跟随
- `VITE_API_PORT`：显式覆盖前端代理目标（仅在不想跟随 `PORT` 时使用）

CORS 开发模式自动放行本机任意端口（`localhost`/`127.0.0.1`），自定义前端端口**无需改任何配置**；生产仍严格 `CORS_ORIGIN` 白名单（生产必填，`validateEnv` fail-fast）。API 默认仅绑定 `127.0.0.1`；容器/反代场景用 `HOST=0.0.0.0`（见 `docs/operations/deployment.md`）。

默认管理员（由 `SEED_ADMIN_*` 控制）：

- 邮箱：`admin@example.local`（可用 `SEED_ADMIN_EMAIL` 覆盖）
- 密码：**必须**在 env 中设置 `SEED_ADMIN_PASSWORD`（缺失则 seed 拒绝执行）
- 角色：`admin`、`adminLevel=100`、`authorTier=elite`
- 已存在同邮箱用户不自动提权，需 `SEED_FORCE_ADMIN=1`

## 功能

- **读者**：首页、知识/LLM 文章、领域详情、搜索、资讯、话题（发帖/回复）、悬停快讲与行内卡片 Agent、登录注册、个人主页、设置（BYOK）、申请成为作者
- **作者**：工作台、Markdown 编辑、动画模板编辑（参数化，非自由画布）、发布
- **管理**：领域管理（`adminLevel ≥ 50`）、作者申请审批（分级 `adminLevel`）
- **双 Agent**（详见 `docs/architecture/agent-modes.md`）
  - **悬停 Agent**：单轮 Fast Direct；流式正文；服务端 `HoverExplainCache`（L2，缓存键 `v7`）+ 前端 L1；净化逻辑在 `@core/contracts`；记忆只读注入
  - **Agent 面板**：`/agent/chat`、`/chat/stream`，单轮结构化提示词（Thought → Explain → Practice → Next）；**P0 真 tool-loop**（`reasoningMode: react` 或勾选「允许工具」：`search_articles` / `get_article`，SSE `tool_call` / `tool_result`）；会话与消息持久化、滚动摘要；记忆注入；**完整推理模式选择 UI 待办**
- **服务架构**：模块化单体，业务域拆分为独立 workspace（`services/identity|content|community|agent|llm`），域间仅经 ports 接口调用、不 import 实现；未来拆微服务只需替换宿主组合根的端口实现。见 `docs/architecture/overview.md`。

## 目录

```
apps/web                前端（Vite + React + TS）
  src/
    app/router.tsx      路由表
    pages/              路由页面（读者 / 账户 / author / admin）
    components/         agent / anim / article / domain / home / layout / ui
    hooks/              useAuth / useTheme / useAnimationPlayer /
                        useAgentPanel / useAgentStyle
    lib/                api / apiToken / agentStream / hoverExplainCache /
                        hoverExplainSession / hoverStreamBuffer /
                        markdown / cardExpandLock / guestKey
services/api            宿主（组合根）：Express 装配、健康检查、docs、prisma schema/seed
  src/compose.ts        ports 实现与依赖注入（微服务化唯一改动点）
  prisma/               schema.prisma · seed.ts · seed-content.ts
packages/contracts      共享 DTO、权限矩阵、悬停净化（hoverSanitize）、LLM 类型
packages/foundation     基础设施：errors/logger/jwt/hash/byokCrypto/sse/中间件等
services/identity       认证/用户/作者申请/设置（User/RefreshToken/AuthorApplication）
services/content       文章/动画/领域/批注（Article/Domain/AnimationDef/Annotation）
services/community     话题论坛（Topic/TopicReply）
services/agent         悬停/面板 Agent、记忆、进度、tool-loop
services/llm           LLM 网关（providers/adapters/熔断/BYOK 解密，持有全部密钥）
services/mcp           MCP 预留（仅 README + 状态探测）
apps/desktop|mobile    desktop/mobile 占位（未来客户端，暂未实现）
_legacy/                旧版静态站归档（已被 .gitignore 忽略）
docs/                   architecture/ 系统设计：overview · agent-modes · animation-system ·
                                        identity-permissions · security
                        operations/   部署运维：postgres · multi-instance-deployment
                        roadmap/      待办路线图：httponly-cookie-migration · tool-loop-roadmap
                        reviews/      审查报告快照：code-review-* · agent-core-review-* ·
                                        architecture-review-* · comprehensive-review-*
                        dev-progress  开发进度 · assets/ 截图附件
                        （索引见 docs/README.md）
```

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 同时启动前端(8180) + API(8181,含 `/docs` Swagger UI) |
| `npm run dev:web` / `dev:api` | 分别启动前端 / API |
| `npm run build` | 构建 shared → web → api |
| `npm run db:seed` | 种子管理员 + 领域 + 文章/动画 |
| `npm test` | api + shared Vitest（悬停净化、tool-loop、BYOK 加密、批注 ACL 等） |
| `npm run lint` | 各 workspace oxlint |

详见 `docs/architecture/overview.md`、`docs/architecture/agent-modes.md`、`docs/architecture/security.md`、`docs/operations/postgres.md`、`docs/dev-progress.md`、`PLAN.md`。
待办深化：`docs/roadmap/httponly-cookie-migration.md`、`docs/roadmap/tool-loop-roadmap.md`。
