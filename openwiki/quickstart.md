---
type: 入口导览
title: 快速开始（AgentForge 代码维基）
description: AgentForge 仓库维基的入口：仓库是什么、wiki 目录地图、任务路由表（改动意图 → 页面/源码/测试/验证）、主要概念链接与 Backlog。
tags: [quickstart, navigation, overview]
---

# AgentForge 代码维基 · 快速开始

本 wiki 是 **AgentForge**（Agent 锻造坊）——一个交互式 Agent / LLM 学习平台（富文本教程 + 可分步动画，读者 / 作者 / 管理员三端 + 内置「双 Agent」体系）的源码导向文档。目标是让人类与编码 Agent 在不读源码的前提下理解仓库、定位改动点、找到聚焦测试与最窄验证命令。

## 仓库是什么

- **Web**：Vite 8 + React 19 + TypeScript + React Router 7（`apps/web`，端口 **5280**）
- **API**：Express 5 + Prisma 6 + SQLite（`apps/api`，端口 **3001**；生产可切 PostgreSQL）
- **共享**：`packages/shared`（DTO、权限矩阵、悬停答案净化——前后端单一真相）
- **LLM**：Anthropic Messages / OpenAI Chat / OpenAI Responses 三格式适配 + BYOK（用户自带密钥）与服务端默认 Provider（默认 StepFun）
- **双 Agent**：悬停快讲（Fast Direct + L1/L2 双层缓存）+ 面板对话（Deep Structured / ReAct tool-loop）
- npm workspaces（`apps/*`、`packages/*`）；Node ≥ 20.3

## Wiki 地图

| 区域 | 页面 | 内容 |
|------|------|------|
| 架构 | [总体架构与 Monorepo](architecture/overview.md) | 目录职责、运行时拓扑、构建顺序、docs 目录与 A-/B-/C-/D-/I- 决策标记约定 |
| 架构 | [Prisma 数据模型与种子](architecture/data-model.md) | 15 个模型、字段语义、关系图、seed 幂等逻辑 |
| 架构 | [安全基线](architecture/security.md) | JWT、RBAC、限流、BYOK 加密与 SSRF、消毒、错误契约 |
| 后端 | [API 组装与中间件](backend/overview.md) | createApp、鉴权/校验/错误中间件、lib 基础设施 |
| 后端 | [身份认证与作者申请](backend/auth-users.md) | auth 全部端点、refresh 旋转、pendingGuard、身份状态机 |
| 后端 | [内容域](backend/content.md) | articles / animations / domains 路由 + serialize.ts 契约 |
| 后端 | [社区域](backend/community.md) | topics 发帖回复软删、annotations 批注 ACL |
| 后端 | [设置与 BYOK](backend/settings-byok.md) | 偏好、BYOK 加密保存/脱敏/test-llm |
| Agent | [双 Agent 总览](agent/overview.md) | 架构对比、SSE 事件协议、/api/v1/agent 路由清单 |
| Agent | [悬停 Agent](agent/hover-agent.md) | L2 缓存 v7、流式早停、答案门控、软流式 |
| Agent | [面板对话](agent/chat-panel.md) | 上下文装配、会话 ACL、历史预算、滚动摘要、记忆 |
| Agent | [ReAct tool-loop](agent/tool-loop.md) | TOOL_CALL 协议、runToolLoop、白名单工具 |
| Agent | [LLM Provider](agent/llm-providers.md) | 加载/解析/调用/流式/适配器 |
| Agent | [提示词与净化](agent/prompt-sanitize.md) | 提示词构造器、extractVisibleAnswer、hoverSanitize 家族 |
| 前端 | [Web 总览](frontend/overview.md) | 提供者树、路由、api 客户端、hooks |
| 前端 | [页面清单](frontend/pages.md) | 读者/账户/作者/管理页面与数据源 |
| 前端 | [Agent UI 全链路](frontend/agent-ui.md) | AgentFloat、hoverTarget、useAgentPanel、L1 缓存、限流 |
| 前端 | [动画系统](frontend/animation-system.md) | 模板→VisualKind、buildScene 八场景、SceneCanvas、播放器 |
| 前端 | [Markdown 管线](frontend/markdown-pipeline.md) | 渲染/消毒/标注/嵌入、MarkdownView 渲染边界 |
| 共享 | [@agentforge/shared](packages/shared.md) | DTO、权限矩阵、hoverSanitize、变更表面 |
| 运维 | [开发与测试](operations/development.md) | 命令、env、测试体系、CI、docker-compose、Backlog 细节 |

## 任务路由表（改动意图 → 页面 / 源码入口 / 聚焦测试 / 最小验证）

| 改动意图 | 先读 | 源码入口 / 关键符号 | 聚焦测试 | 最小验证 |
|----------|------|---------------------|----------|----------|
| 改认证 / 令牌 | [auth-users](backend/auth-users.md) | `routes/auth.ts` `issueTokenPair`、`lib/jwt.ts` | `lib/jwt.test.ts` | `npm test --workspace=@agentforge/api` |
| 改权限门槛 | [安全基线](architecture/security.md)、[shared](packages/shared.md) | `packages/shared/src/permissions.ts` `can()`、`middleware/auth.ts` | shared `smoke.test.ts` | 同上 |
| 改文章/动画/领域 API | [内容域](backend/content.md) | `routes/articles.ts` / `animations.ts` / `domains.ts`、`services/serialize.ts` | —（无路由级测试） | `curl /health` + 手动走 CRUD |
| 改批注 ACL | [社区域](backend/community.md) | `services/annotationAcl.ts` | `services/annotationAcl.test.ts` | 同上 |
| 改悬停讲解链路 | [悬停 Agent](agent/hover-agent.md)、[Agent UI](frontend/agent-ui.md) | `routes/agent.ts`、`services/agentOrchestrator.ts`、`services/hoverCache.ts` | `agent.sse.test.ts`、`hoverCache.test.ts`、`agentPrompt.hover.test.ts` | `npm run test:hover --workspace=@agentforge/api` |
| 改净化正则 | [提示词与净化](agent/prompt-sanitize.md) | `packages/shared/src/hoverSanitize.ts` | `agentPrompt.hover.test.ts`、shared `smoke.test.ts` | `npm test --workspace=@agentforge/shared` |
| 改 tool-loop / 工具 | [ReAct tool-loop](agent/tool-loop.md) | `lib/llm/tools/*`（toolLoop / registry / parseToolCall） | `lib/llm/tools/tools.test.ts` | 同上 |
| 改 Provider / 适配器 | [LLM Provider](agent/llm-providers.md) | `lib/llm/providers.ts`、`lib/llm/adapters/*`、`lib/llm/config.ts` | `lib/llm/providers.test.ts` | 同上 |
| 改 BYOK 加密/SSRF | [设置与 BYOK](backend/settings-byok.md) | `lib/byokCrypto.ts`、`lib/byokUrlPolicy.ts` | `byokCrypto.test.ts`、`byokUrlPolicy.test.ts` | 同上 |
| 改前端页面/路由 | [页面清单](frontend/pages.md) | `app/router.tsx`、`pages/*`、`components/*` | —（无前端测试） | `npm run dev:web` |
| 改 Agent 前端交互 | [Agent UI](frontend/agent-ui.md) | `components/agent/AgentFloat.tsx`、`lib/hoverExplainSession.ts`、`lib/agentStream.ts` | — | `npm run dev:web` + `dev:api` |
| 改动画引擎 | [动画系统](frontend/animation-system.md) | `components/anim/`（registry / core/buildScene / primitives/SceneCanvas） | — | `npm run dev:web` |
| 改 Markdown 渲染/消毒 | [Markdown 管线](frontend/markdown-pipeline.md) | `lib/markdown.ts`、`components/agent/MarkdownView.tsx` | — | `npm run dev:web` 悬停验证 |
| 改 DTO / 共享类型 | [shared](packages/shared.md) | `packages/shared/src/index.ts` | shared `smoke.test.ts` | `npm run build`（先 shared 再两端） |
| 加环境变量 / 部署 | [开发与测试](operations/development.md) | `.env.example`、`app.ts`、`docker-compose.yml` | — | `npm run build && npm test` |
| 加 CI / 工作流 | [开发与测试](operations/development.md) | `.github/workflows/ci.yml`、`openwiki-update.yml` | — | `npm ci` + 各 workspace 构建/测试 |

## 最常用命令

```bash
npm install
cp .env.example apps/api/.env   # 必填 SEED_ADMIN_PASSWORD、JWT_SECRET
cd apps/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev:api   # :3001
npm run dev:web   # :5280（/api 代理到 3001）
npm run build     # shared → web → api
npm test          # api + shared Vitest
```

## 主要概念速览

- **双 Agent**：[悬停](agent/hover-agent.md)（速度优先、2–3 句卡片、L1/L2 缓存、早停）vs [面板](agent/chat-panel.md)（会话持久化、记忆注入、[ReAct tool-loop](agent/tool-loop.md)）。二者共享 [Provider 抽象](agent/llm-providers.md) 与 [净化单一真相](agent/prompt-sanitize.md)。
- **身份模型**：guest / reader / author（authorTier）/ admin（adminLevel 1–100）；矩阵见 [shared](packages/shared.md)，令牌生命周期见 [auth-users](backend/auth-users.md)。
- **BYOK**：用户自带 LLM 配置，AES-256-GCM 静态加密入库 + SSRF URL 策略双重校验，见 [设置与 BYOK](backend/settings-byok.md)。
- **动画**：`:::animation{id=...}:::` 嵌入；模板 → VisualKind 映射 → 场景生成 → SVG 渲染，见 [动画系统](frontend/animation-system.md)。
- **Markdown**：作者标注 `[[术语|提示]]` 悬停可讲、`{agent=...}` 图片、DOMPurify 白名单，见 [Markdown 管线](frontend/markdown-pipeline.md)。
- **docs/ 目录**：`docs/architecture.md`、`docs/agent-modes.md`、`docs/security.md`、`docs/identity-permissions.md` 为权威文档（本 wiki 以代码为准并链接引用）；`code-review-*` / `comprehensive-review-*` / `architecture-review-*` 为历史 review 快照。代码注释中的 **A-/B-/C-/D-/I- 标记**（如 A-01 LLM 错误脱敏、A-04 规则复述门控、B-05 重试策略、I5 先持久化再 final）是跨文件不变量的索引，见 [总体架构](architecture/overview.md)。

## Backlog（有依据的延后项）

以下区域**当前未实现或仅占位**，wiki 不做虚构覆盖；改动前先确认是否已实现：

- `services/agent`、`services/mcp`：仅 README 占位；站内 Agent 在 `apps/api`，MCP 仅有 `GET /api/v1/mcp/status` 探测（证据：`services/*/README.md`、`docs/architecture.md`）。
- tool-loop P1/P2：更多只读工具、推理模式选择器 UI、observation 注入防御、独立限流、原生 tools API（`docs/tool-loop-roadmap.md`）。
- HttpOnly Cookie 迁移：access/refresh 目前存 SPA localStorage（`docs/httponly-cookie-migration.md`）。
- 评论 CRUD、Agent 自动审注（`User.allowAgentAnnotationReview` 未接线）、批注审核前端 UI、学习进度可视化、多会话列表 UI。
- 生产化：强 JWT_SECRET/SEED_ADMIN_PASSWORD、PostgreSQL + HTTPS、Docker 镜像、监控、i18n（`docs/dev-progress.md` 阶段状态：面板 Agent 80%、批注 50%、MCP/Runtime 10%、评论 0%、部署 30%）。
- 根目录 `api/` 空壳目录请勿使用（以 `apps/api` 为准）。
