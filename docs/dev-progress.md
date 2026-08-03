# AgentForge 开发进度报告

> 报告日期：2026-07-23
> 范围：以 `apps/`、`packages/`、`services/`、`prisma/`、`docs/` 当前代码为准
> 阅读顺序：① 已实现清单 ② 实现方式（怎么做） ③ 未实现清单 ④ 修改建议

---

## 1. 已实现清单

### 1.1 平台与基础设施

| 能力 | 实现位置 | 备注 |
|------|----------|------|
| Monorepo（npm workspaces） | 根 `package.json` | `apps/*` + `packages/*`；顶层脚本 `dev:web` / `dev:api` / `build` / `db:*` |
| 共享类型与权限 | `packages/shared/src/{index.ts, permissions.ts}` | `UserRole`、`AuthorTier`、`Permission` 矩阵；`can(principal, perm)` |
| SQLite + Prisma | `apps/api/prisma/schema.prisma` | 已定义 13 个模型（含 `Annotation`） |
| 健康检查 | `apps/api/src/app.ts` `GET /health` | 返回 `{ ok, service, ts }` |

### 1.2 后端（apps/api）

| 路由 | 文件 | 行为 |
|------|------|------|
| `/api/v1/auth/*` | `routes/auth.ts` | `register / login / logout / refresh / me`；JWT 双 token；bcrypt cost 12 |
| `/api/v1/articles` | `routes/articles.ts` | CRUD + 发布/草稿 + 嵌入动画；按 `status/domain/category` 索引 |
| `/api/v1/animations` | `routes/animations.ts` | 作者 CRUD；按 `template` 索引 |
| `/api/v1/author-applications` | `routes/applications.ts` | reader 提交 / admin 审批；区分 `author | elite` |
| `/api/v1/domains` | `routes/domains.ts` | admin ≥50 管理 |
| `/api/v1/settings` | `routes/settings.ts` | BYOK 配置（用户偏好 `preferences` JSON） |
| `/api/v1/topics` | `routes/topics.ts` | 话题发帖/回复（可附文章） |
| `/api/v1/agent/*` | `routes/agent.ts` | 见 §1.4 |
| `/api/v1/mcp/status` | `app.ts` | MCP 协议占位探测，返回 `status: 'reserved'` |

中间件（`apps/api/src/middleware/`）：
- `auth.ts`：`optionalAuth` / `requireAuth` / `requireRole(...)` / `requirePermission(...)` / `requireAdminLevel(min)`
- `validate.ts`：Zod schema 包装
- `errorHandler.ts`：统一错误体（`AppError`、Zod、Prisma `P2002/P2003/P2025` 映射）

LLM Provider 层（`apps/api/src/lib/llm/`）：
- `providers.ts`：支持 `anthropic_messages` / `openai_chat` / `openai_responses` 三种 API 格式；BYOK 优先，服务端默认兜底；流式逐 token 解析 thinking + text
- `agentPrompt.ts`：Prompt 构造 + 答案净化（详见 §1.4）
- `types.ts`：Provider / LLM 请求/响应类型

### 1.3 前端（apps/web）

- 路由：`apps/web/src/app/router.tsx`（22 条路由，覆盖读者/账户/作者/管理）
- 页面：`pages/` 下 15 个文件（含 `admin/DomainsAdminPage` 与 `author/*` 四页）
- 组件：`components/{agent, anim, article, domain, home, layout, ui}`
- 钩子：`useAuth` / `useTheme` / `useAnimationPlayer`
- 工具库：`api` / `apiToken` / `agentStream` / `hoverExplainCache` / `markdown` / `cardExpandLock`
- 样式：`tokens.css` + `global.css`（主题、深浅色）

### 1.4 双 Agent（重点）

#### 悬停 Agent

- API：`POST /api/v1/agent/explain` 与 `POST /api/v1/agent/explain/stream`，`mode: hover | click`
- Prompt：`buildHoverSystem(style, memoryBlock)` — 硬上限 2～3 句、≤220 字、禁用列表/标题/规则复述
- 上下文组装：`loadUserContext(userId, route)` 读取 `AgentMemory`（最近 40 条）+ `LearningProgress`（最近 50 条），按「已掌握 / 学习中 / 最近问过 / 备注」组装为 `memoryBlock`
- 缓存：
  - 服务端 `HoverExplainCache`（Prisma 表）：默认 TTL 2h；`hits≥8` 延长至 24h；写入前 `isCompleteHoverAnswer` 质检（拒绝策划稿 / 改稿残骸 / 半截输出 / 规则回声 / 末尾标点不合规）
  - 键格式：`sha256('v5::' + style + '::' + normalized(topic))`，前 48 字符
  - 前端 `lib/hoverExplainCache.ts` 提供 L1
- 流式：thinking **永不向客户端暴露**（悬停硬规则），仅推送 `status: thinking`（120ms 节流）；正文按句 soft-stream（句间 ~90ms 渐显）
- 清洗：`extractHoverAnswer` → `finalizeHoverCardText` → `looksLikeHoverPlanning` / `isLikelyHoverTeaching` 双重过滤
- 维护：`POST /api/v1/agent/cache/clear`（需登录），可一键清空 L2

#### Agent 面板

- API：`POST /api/v1/agent/chat` 与 `POST /api/v1/agent/chat/stream`，`mode: fast | deep`（内部区分，未产品化为推理模式选择器）
- Prompt：`buildDeepSystem(style, memoryBlock)` — 结构 `Thought / Explain / Practice / Next` 四段（prompted ReAct 骨架，**非真 tool-loop**）
- 会话：`AgentConversation` + `AgentMessage` 持久化；`ensureConversation(userId, conversationId?)` 做归属校验（匿名仅允许 `userId=null` 会话）
- 摘要：消息数 > 24 时滚动压缩最旧 8 条到 `AgentConversation.summary`（snippet ≤ 500 字符）
- 历史注入：取最近 12 条反转拼接进 `system`
- 记忆：读 `AgentMemory` + `LearningProgress`；写时匹配「请记住 / 我的偏好 / 以后…用」等启发式 → upsert `preference` 类记忆
- 流式：deep 模式透传 `thinking` / `delta` / `final`；fast 模式只推送 `status` 与 `final`，正文中途不暴露
- 进度：`POST /progress`（`articleSlug` 必填）；`mastery=mastered` 时追加 `mastered:<slug>` 记忆
- Provider：`mode=fast` 同步 maxTokens 700 / 流式 500；`mode=deep` 2048

### 1.5 动画系统

- 类型：`VisualKind` 8 种（`ring / chain / tree / graph / flow / dataflow / layers / timeline`），含 `VizNode / VizEdge / VizFrame / SceneModel` 与 `ROLE_COLORS`
- 模板映射：`TEMPLATE_KIND` 覆盖 16 个模板 id（`react/loop/cot/tot/got/mcp/tool/harness/evaluation/memory/frameworks-*` + `llm-basics/transformers/tokenization/fine-tuning/prompt-eng`），未识别回退 `timeline`
- 渲染：`primitives/SceneCanvas.tsx`（SVG）+ `primitives/layoutMath.ts`（环/弧/曲线几何）
- 步骤：`templates/defaultSteps.ts` 提供 `DEFAULT_STEPS[template]`，`type` 驱动高亮
- 控件：`AnimationViewer` + `AnimationControls` + `anim-engine.css`；`useAnimationPlayer` 提供 play / pause / step / stepBack / reset / speed

### 1.6 安全

详见 `docs/security.md`：bcrypt、JWT、CORS、helmet、限流（全局 120/min · auth 20/min · agent 40/min）、Zod、DOMPurify、统一错误体、BYOK 脱敏展示与日志脱敏。

### 1.7 种子与数据

- 管理员：`apps/api/prisma/seed.ts` — 邮箱 `SEED_ADMIN_EMAIL`（默认 `admin@agentforge.local`）、密码 `SEED_ADMIN_PASSWORD`（默认 `ChangeMe_Admin_123!`，bcrypt 12）；`adminLevel=100`、`authorTier=elite`；不重置已有管理员密码
- 领域：5 个默认领域（reasoning / frameworks / protocols / engineering / llm-foundations），按 `category / slug` 路由种子文章
- 文章：`seed-content.ts` `DEFAULT_ARTICLE_SEEDS`，覆盖 `react / cot / tot / got / mcp / context / loop / harness / memory / evaluation / tool-use / prompt-eng / frameworks/{langchain, autogen, crewai} / llm/basics / transformers / tokenization / fine-tuning / prompting`

---

## 2. 实现方式（关键原理）

### 2.1 悬停答案净化（核心痛点）

模型常把「自我改稿 / 写作规则 / 策划提示词」混进正文（典型如「首先第一句讲核心…对，要短…那调整下…」）。`agentPrompt.ts` 通过以下层次过滤：

1. **正则黑名单**：`PLANNING_HINT` / `HOVER_META` / `SYSTEM_ECHO` / `TASK_ECHO` / `SELF_REVISION` / `SELF_TALK_PHRASE`
2. **单元拆分**：按句末标点（`[。！？]`）或换行拆分为原子单元
3. **单元判定**：`isTeachingUnit` 白名单 + `isSelfTalkSentence` 黑名单；可保留的前缀（如「首先，ReAct…」之前的术语定义）会被截留
4. **改稿末稿提取**：`stripSelfRevisionDraft` 按 `调整：/最终版：/正文如下：` 切片，从后往前取第一段通过 `isLikelyHoverTeaching` 的版本（覆盖 maxTokens 截断场景）
5. **缓存门**：`isCompleteHoverAnswer` 强制 1–3 句、句末必有句号、长度合规，否则不入库
6. **流式策略**：服务端**只累计不推送** thinking/text；流式结束后 `extractHoverAnswer` 清洗，按句 soft-stream；任何不达标一律返回空（前端显示失败态）

### 2.2 服务端两级缓存 + 缓存键版本化

- L2（`HoverExplainCache`）：按 style + topic 规范化后 sha256，命中热点后 TTL 延长；质检失败不回退写库
- L1（前端 `hoverExplainCache.ts`）：localStorage 限频
- 缓存键前缀 `v5::`：每次出现 bug（如 bug-4「任务提示回声」）即升前缀，让旧脏缓存自动失效

### 2.3 会话归属安全

`ensureConversation`：
- 已登录：仅允许 `existing.userId === userId` 的会话
- 匿名：仅允许无主（`userId=null`）会话
- 不匹配 → 视作找不到 → 走新建路径

避免匿名端通过 `conversationId` 读到他人的会话消息。

### 2.4 路由限流分层

`apps/api/src/app.ts`：
- `generalLimiter` 120/min 全局
- `authLimiter` 20/min 锁认证路由
- `agentLimiter` 40/min 锁 Agent 路由（成本高）

部署在反向代理后启用 `app.set('trust proxy', 1)`，避免 express-rate-limit v7 因 `X-Forwarded-For` 校验抛错。

### 2.5 Markdown 消毒

`apps/web/src/lib/markdown.ts`：
- `DOMPurify.sanitize(raw, { ALLOWED_TAGS, ALLOWED_ATTR })` 在浏览器侧渲染前过滤
- 服务端不再做（前端渲染路径已足够，且无需服务端视图）

### 2.6 动画数据流

`AnimationDef.steps`（JSON 字符串）→ Prisma 读取 → `serialize.ts` 解析为对象 → `AnimationViewer` 渲染

`buildScene(template, steps)`：
1. `TEMPLATE_KIND[template]` → `VisualKind`
2. 按 kind 选 `buildRingScene` / `buildChainScene` / ... 构建 `SceneModel`（节点 / 边 / 帧序列）
3. `SceneCanvas` 按 `SceneModel.frames[stepIndex]` 高亮 + 流动粒子

`VizFrame` 字段同时支持环状（`cycle / maxCycles`）、树/图（`pathNodeIds`）、数据流（`packet: { edgeId, t }`）。

### 2.7 统一错误体

`errorHandler.ts`：
- `AppError`：业务可控错误（`status + code + message`）
- `ZodError`：`VALIDATION_ERROR` + 拼接 `e.message`
- `Prisma.PrismaClientKnownRequestError`：`P2002` → 409 `CONFLICT`；`P2003` → 400 `FOREIGN_KEY`；`P2025` → 404 `NOT_FOUND`
- 兜底 500 不暴露堆栈

### 2.8 流式 LLM 解析

`streamLlm` 抽象为 `AsyncGenerator<StreamChunk, void, unknown>`，`chunk.kind` 区分 `text` / `thinking`。

- Anthropic Messages：解析 `content_block_start` / `content_block_delta` 中的 `text_delta` 与 `thinking_delta`
- OpenAI Chat：解析 `choices[0].delta.content` 与 `reasoning_content`
- OpenAI Responses：流式能力有限，**回退到非流式**，整体一次性 yield

流式失败时（如 SSE 头异常）尝试降级到非流式调用一次，提升容错。

---

## 3. 未实现清单

### 3.1 Agent / MCP

| 项 | 说明 |
|----|------|
| 工具循环（tool-loop） | 面板助手当前仍是「单轮结构化 prompt」，**没有真实 Tool Call / Observation**；工具状态 SSE 也未启用 |
| 推理模式切换 UI | `react / plan_execute / deep_teach / socratic / chat` 等模式**未产品化**；当前仅 `mode: fast | deep` 内部区分 |
| MCP Server 进程 | `services/mcp` 仅有 README；仅 `GET /api/v1/mcp/status` 探测接口；stdio/SSE 入口、`tools/articles.ts`、`tools/domains.ts` **未实现** |
| 独立 Agent Runtime | `services/agent` 仅 README；计划中的进程拆分**未开始** |
| 批注审核 API | `Annotation` 表已建（`status: pending|approved|rejected`、`reviewBy: author|agent|admin`、`reviewerId`），但 `apps/api/src/routes/` 中**没有 annotations 路由**；前端无批注 UI |
| 批注 Agent 自动审核 | `allowAgentAnnotationReview` 字段已存在但**无人调用** |

### 3.2 内容与社区

| 项 | 说明 |
|----|------|
| 评论 CRUD | 文档原计划「预留 UI/表结构」，当前**模型与路由都无** |
| 话题软删除 UI | `Topic.status` 字段支持软删除，前端未提供删除入口 |
| 通知 / 站内信 | 未实现 |

### 3.3 平台工程

| 项 | 说明 |
|----|------|
| 部署脚本 | 无 Dockerfile / docker-compose（PLAN 中提到的可选 Postgres 容器未落地） |
| CI / 自动化测试 | Vitest 已接入 `apps/api`（`agentPrompt.hover.test.ts` 净化回归 11 例，`npm test`）；旧 `scripts/` 遗留脚本已随静态站移入 `_legacy/` |
| 生产数据库 | 默认 SQLite；PostgreSQL 切换需改 `provider` + 迁移脚本 |
| 监控 / 指标 | 无 Prometheus / Sentry / 日志聚合 |
| 国际化 | 全站中文硬编码，无 i18n 框架 |

### 3.4 前端体验

| 项 | 说明 |
|----|------|
| 评论占位 UI | 文章页**没有评论组件**（既不显示预留也不隐藏） |
| 批注 UI | 未提供 |
| 头像上传 | `User.avatarUrl` 字段有，无上传接口/UI |
| 个人主页统计 | `ProfilePage` 缺学习进度可视化 |
| 优秀作者申请 | `ApplicationsAdminPage` 已能审批 `kind=elite`，但前端无单独入口 |

---

## 4. 修改建议

### 4.1 文档（已在本轮更新中处理）

| 文档 | 调整 |
|------|------|
| `README.md` | 端口/CORS/默认 Provider/管理员环境变量/`services/` 状态都已对齐代码 |
| `docs/architecture.md` | 全量重写，对齐实际目录、路由、组件 |
| `docs/agent-modes.md` | §2.2 / §3.2 / §3.3 / §7 补「代码为准」的事实（缓存 TTL、maxTokens、Provider 三种格式、MCP/Runtime 未实现） |
| `docs/animation-system.md` | 补充 `timeline` 兜底 + 16 个模板 id 完整映射 |
| `docs/identity-permissions.md` | 标注 `Annotation` 模型已有但**路由缺失**；话题软删除字段；Agent 上下文细节（滚动摘要、mastered 写记忆） |
| `docs/security.md` | 重写为「对照代码的实际清单」+ 路由限流一览；明确「BYOK 不写日志」与 `maskApiKey` |
| `PLAN.md` | 状态行更新日期与提示；阶段标注实际完成情况；§8 与 §3.2 区分原则 vs 未实现 |
| `docs/dev-progress.md`（新增） | 本文件 |

### 4.2 代码层面

1. **后端 Agent**
   - 把 `Annotation` 路由补齐：`POST /annotations`（读者提交）/`GET /articles/:slug/annotations`（仅 approved）/`PATCH /annotations/:id`（作者或 admin 或允许的 Agent）
   - 把 `routes/agent.ts` 中 `mode: fast | deep` 升级为可枚举推理模式（`react/plan_execute/deep_teach/socratic/chat`），加模式切换 SSE
   - 抽出最小 `tool-loop`：先内置 `search_articles` + `get_article` + `list_domains` 三个工具，UI 上展示「正在调用 xxx」状态
2. **MCP**
   - 在 `apps/api/src/` 内新增 `routes/mcp.ts`，按 MCP Streamable HTTP 规范实现 `tools/list`、`tools/call`、`resources/list`、`resources/read`
   - 工具实现层放在 `apps/api/src/lib/mcp/tools/`，与 `services/mcp` 共享契约
3. **数据库 / 部署**
   - 在 `schema.prisma` 注释里补一句「Postgres 切换需要把 `provider = sqlite` 改为 `postgresql` 并跑迁移」
   - 加一个最小的 `Dockerfile.api`（Node 20 + 仅依赖）+ `docker-compose.yml`（可选 Postgres）
4. **前端**
   - `apps/web/src/lib/agentStream.ts` 已存在；建议增加 abort + 重试能力（面板体验）
   - 卡片行内 Agent：`ArticleCardInlineAgent` 已有 `cardExpandLock`，建议补「失败重试」按钮
   - 路由级别懒加载：`createBrowserRouter` 当前同步导入所有页面，建议改为 `lazy()` + `Suspense`（构建后首屏可减半）
5. **测试**
   - `apps/api/` 添加 `vitest` 配置；优先覆盖：
     - `extractHoverAnswer` 的回归测试（bug-1 / bug-2 / bug-3 / bug-4 各一条样本）
     - `isCompleteHoverAnswer` 的边界（≤11 字、>260 字、问号、半截）
     - `ensureConversation` 归属校验（匿名访问他人会话 ID）
   - `apps/web/` 增加 `vitest` + `@testing-library/react`，覆盖 `useAuth` 状态机与 `cardExpandLock`
6. **可观测性**
   - `errorHandler` 已结构化输出错误体；建议接入 `pino` JSON 日志（含 `requestId`）便于检索
   - Agent 路径单独埋点（缓存命中、模型、provider、maxTokens、耗时）

### 4.3 流程层面

1. **缓存键版本管理**
   - 当前 `v5::` 前缀靠 PR review 同步；建议在 `agentPrompt.ts` 顶部加注释，列出每次升版本对应的 bug / commit
2. **Prompt 变更评审**
   - `buildHoverSystem` / `buildDeepSystem` 的硬规则一旦改动，回归测试必跑；建议把这两段加 CI 必跑
3. **Provider 灰度**
   - 服务端默认 + BYOK 可同时启用，但 UI 仅展示当前用户生效的那一个；建议 `/providers` 返回的列表默认隐藏未配置 `apiKey` 的项
4. **种子内容 QA**
   - `seed-content.ts` 包含 21 篇长文；建议加 `npm run content:lint`（统计字数、检查 `:::animation{id=...}:::` 落点），纳入 CI
5. **安全 checklist 入库**
   - 把 `docs/security.md` 中的「未实现/待办」作为 GitHub Issue 模板字段，新 PR 强制勾选
6. **阶段门禁**
   - PLAN 中 Phase G「上线准备」建议补：
     - `npm run build` 通过（已具备）
     - `npm run lint` 通过
     - `docs/security.md` 中所有未勾选项已建 Issue
     - 至少 1 条 e2e（注册→申请→审批→发文→发布→读者可见）

---

## 5. 进度概览（一图速览）

```
平台 / 鉴权 / 内容管理  ██████████ 100%
读者体验（首页/搜索/话题/资讯） ██████████ 100%
作者端（CMS + 动画编辑器）   ██████████ 100%
种子内容（21 篇长文 + 动画） ██████████ 100%
悬停 Agent（快讲 + 缓存 + 净化） ██████████ 100%（含若干次 bug 修复）
面板 Agent（会话 + 记忆 + 流式） ██████░░░░ 60%（无 tool-loop / 模式切换）
MCP 协议 / 服务             █░░░░░░░░░  10%（仅占位接口）
独立 Agent Runtime          ░░░░░░░░░░   0%（仅 README）
批注 / 评论                 █░░░░░░░░░  10%（模型已建，无路由）
测试 / 监控 / 部署          ██░░░░░░░░  20%（仅有遗留脚本）
```

> 百分比为本报告作者基于代码与文档覆盖度的主观评估，仅作排序参考。