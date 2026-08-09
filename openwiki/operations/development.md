---
type: 运维开发
title: 本地开发、测试体系与 CI
description: 开发命令、环境变量、prisma 流程、Vitest 测试矩阵与 mock 模式、CI/openwiki 工作流、docker-compose 与预留服务。
tags: [operations, development, testing, ci]
---

# 本地开发、测试体系与 CI

## 环境要求与命令

Node ≥ 20.3（`package.json engines`）；npm workspaces（`apps/*`、`packages/*`，**无 pnpm**）。

| 命令 | 作用 |
|------|------|
| `npm run dev:web` | Vite dev（:5280，/api 代理 → :3001） |
| `npm run dev:api` | tsx watch（:3001） |
| `npm run build` | 顺序构建 shared → web → api（shared dist 是两端依赖） |
| `npm test` | api Vitest → shared Vitest（--if-present） |
| `npm run lint` | 各 workspace oxlint |
| `npm run db:generate` / `db:migrate` / `db:seed` | prisma generate / migrate dev / seed |
| `npm run test:hover` | 仅悬停净化套件（agentPrompt.hover.test.ts） |

**启动流程**：`npm install` → 复制 `.env.example` 为 `apps/api/.env`（`SEED_ADMIN_PASSWORD` 与 `JWT_SECRET` 必填）→ `npx prisma db push` → `npm run db:seed` → 两个终端分别 `dev:api` / `dev:web`。

## 环境变量（.env.example）

- **API**：`PORT`(3001)、`NODE_ENV`、`DATABASE_URL`（默认 `file:./dev.db`，生产 PostgreSQL 见 docs/postgres.md）、`JWT_SECRET`（≥16 字符，缺失启动即抛）、`JWT_ACCESS_EXPIRES_IN`(15m) / `JWT_REFRESH_EXPIRES_IN`(7d)、`CORS_ORIGIN`（逗号分隔白名单，默认 http://localhost:5280）、`TRUST_PROXY`（仅反向代理后置 1）、`LOG_LEVEL`、`BYOK_ENCRYPTION_KEY`（≥16，未设回退 JWT_SECRET 派生）。
- **Web**：`VITE_API_BASE_URL`（默认 `/api/v1`，dev 走代理）。
- **Seed**：`SEED_ADMIN_EMAIL/NAME/PASSWORD`（PASSWORD 必填 ≥8，**无内置兜底**）、`SEED_FORCE_ADMIN=1`（同邮箱已存在才提权）。
- **LLM**：`LLM_PROVIDER_ID`(stepfun)、`STEPFUN_*`、`OPENAI_*`、`GENERIC_LLM_*`；可选 `TOOL_LOOP_MAX_ITERS`(5)、`TOOL_TIMEOUT_MS`(8000)。

## 测试体系（Vitest，node 环境）

`apps/api/vitest.config.ts`：`include: ['src/**/*.test.ts']`，测试与源码共置。**统一 mock 模式**：服务/库测试 `vi.mock('../lib/prisma.js')`（PrismaClient 单例在 `lib/prisma.ts`，globalThis 挂载）；`providers.test.ts`/`agent.sse.test.ts` 额外 mock/spy fetch；环境变量在 beforeEach/afterEach 设置与清理（provider 模块级缓存须 `resetProviderCache()`）。

| 文件 | 断言焦点 |
|------|----------|
| `routes/agent.sse.test.ts` | 真实 HTTP server：悬停早停（≥2 句触发 abort、无 thinking 事件、done 最后、写 L2 缓存）；LlmCallError 脱敏（SSE error 消息不含 url/raw）；deep thinking 规则回声分片过滤 |
| `services/hoverCache.test.ts` | key v7 稳定/归一化/48 位 hash；脏行删除；TTL 2h / hits≥8 → 24h；set 质量门 |
| `services/annotationAcl.test.ts` | 列表可见性三档；审核 ACL（同文作者/admin；elite 不跨文）；reviewBy 优先级 |
| `services/agentConversation.test.ts` | ensureConversation：他人/过期/guestKey 不匹配/无 guestKey → 新建；合法复用；7 天 TTL |
| `lib/byokCrypto.test.ts` | AES-256-GCM 往返、legacy 明文兼容、坏密文 → ''、密钥轮换 → 静默失效；resolveByokApiKeyToStore（二次保存不重加密、掩码保留、轮换保留密文） |
| `lib/byokUrlPolicy.test.ts` | 私网/环回/metadata/CGNAT/IPv6 拦截；协议与凭据限制；规范化 |
| `lib/jwt.test.ts` | parseDurationMs、refresh 熵与 sha256、过期配置优先级 |
| `lib/llm/providers.test.ts` | 三格式 URL 解析、env 加载与缓存、BYOK 解析（SSRF 抛错）、resolveProvider 优先级、超时/重试（5xx 重试一次、401 不重试、TypeError 重试、超时 408 无重试）、各格式 fetch 收到合成 AbortSignal |
| `lib/llm/tools/tools.test.ts` | parseToolCall、白名单恰两项、未知/非法参数 → observation 错误串、maxIters 兜底与 SSE 事件数 |
| `lib/llm/agentPrompt.hover.test.ts` | 12 个净化命名用例（bug1–4、shot 格式、good-llm/cot、mixed-revision） |
| `packages/shared/src/smoke.test.ts` | 权限分级 + 净化冒烟 |

`scripts/test-hover-extract.ts`：旧 shim（spawnSync vitest 指定套件），保留兼容旧文档链接，非正式入口。根目录 `tests/integration`、`tests/unit` 为**空目录遗留**。

## CI 与自动文档工作流（.github/workflows/）

**ci.yml**（push master/main + PR）：`actions/checkout@v4` → `actions/setup-node@v4`（**node 20 + npm cache**）→ `npm ci` → build shared（先，两端依赖 dist）→ api Vitest（`npm test --workspace=@agentforge/api`）→ shared Vitest（**`--if-present` 标志**，共享包无测试时不失败）→ web typecheck/build（`npm run build --workspace=@agentforge/web`）→ api build。**本地与 CI 的差异点**：CI 全量 npm ci + 显式 shared 构建，本地 `npm test` 不构建。

**openwiki-update.yml**（每日 8:00 cron + workflow_dispatch）：`openwiki code --update --print`（OpenRouter + `z-ai/glm-5.2`），写回 `openwiki/`、`AGENTS.md`、`CLAUDE.md`，以 `openwiki/update` 分支开 PR。**本 wiki 由该工作流自动刷新，勿手改生成页**。

## 部署形态

- 开发：SQLite（`file:./dev.db`）+ 双进程。`docker-compose.yml`：可选 postgres:16-alpine（agentforge 库、5432、healthcheck），生产切换见 `docs/postgres.md`（改 schema datasource provider、generate/db push/seed；dev.db 不可复用）。
- 未实现/待办（见 `PLAN.md` 与 `docs/dev-progress.md`）：生产强密钥、HTTPS 终止、备份与密钥轮转、Docker 镜像、监控、i18n。

## 预留服务与归档

- `services/agent`：仅 README——站内双 Agent 已在 `apps/api` 实现；未来拆独立 Runtime（编排层迁入，保持 SSE 契约）。
- `services/mcp`：仅 README + `GET /api/v1/mcp/status`（`{ok:true, status:'reserved'}`）；规划只读工具 search_articles/get_article/list_domains，JWT/服务账号鉴权，与站内 Agent 解耦。
- `_legacy/`：旧静态站归档（.gitignore 忽略，历史 46 文件已跟踪）。
- 根目录空壳 `api/`：**勿混用，以 apps/api 为准**（docs/architecture.md 明示）。

## 相关页面

- 部署与安全基线：[安全设计](../architecture/security.md)
- 数据与种子：[数据模型](../architecture/data-model.md)
- 快速入口：[quickstart](../quickstart.md)
