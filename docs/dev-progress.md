# AgentForge 开发进度报告

> 报告日期：2026-08-03  
> 范围：以 `apps/`、`packages/`、`services/`、`docs/` 当前代码为准  
> 阅读顺序：① 已实现 ② 实现要点 ③ 未实现 ④ 建议

---

## 1. 已实现清单

### 1.1 平台与基础设施

| 能力 | 位置 | 备注 |
|------|------|------|
| Monorepo（npm workspaces） | 根 `package.json` | `apps/*` + `packages/*`；Node ≥20 |
| 共享类型 / 权限 / 悬停净化 | `packages/shared` | `permissions.ts` + `hoverSanitize.ts` |
| SQLite + Prisma | `apps/api/prisma/schema.prisma` | 13 个模型（含 `Annotation`） |
| 健康检查 | `GET /health` | `{ ok, service, ts }` |
| 结构化日志 | `apps/api/src/lib/logger.ts` | Pino |

### 1.2 后端（apps/api）

| 路由 | 文件 | 行为 |
|------|------|------|
| `/api/v1/auth/*` | `routes/auth.ts` | `register / login / logout / me`（GET+PATCH）；**仅 accessToken，无 refresh** |
| `/api/v1/articles` | `routes/articles.ts` | CRUD + 发布 + 嵌入动画 |
| `/api/v1/animations` | `routes/animations.ts` | 作者 CRUD |
| `/api/v1/author-applications` | `routes/applications.ts` | `author \| elite` 申请与审批 |
| `/api/v1/domains` | `routes/domains.ts` | admin ≥50 管理 |
| `/api/v1/settings` | `routes/settings.ts` | BYOK（`preferences` JSON） |
| `/api/v1/topics` | `routes/topics.ts` | 发帖/回复 |
| `/api/v1/agent/*` | `routes/agent.ts` | 见 §1.4（**已实装，非 501**） |
| `/api/v1/mcp/status` | `app.ts` | `status: 'reserved'` |

中间件：`optionalAuth` / `requireAuth` / `requireRole` / `requirePermission` / `requireAdminLevel`；Zod `validate`；统一 `errorHandler`。

LLM：`providers.ts`（`anthropic_messages` / `openai_chat` / `openai_responses`；BYOK 优先）；`agentPrompt.ts`。

### 1.3 前端（apps/web）

- 路由约 22 条（读者 / 账户 / author / admin + 404）
- 组件：`agent` · `anim` · `article` · `domain` · `home` · `layout` · `ui`
- 钩子：`useAuth` / `useTheme` / `useAnimationPlayer`
- 工具：`api` / `apiToken` / `agentStream` / `hoverExplainCache` / `markdown` / `cardExpandLock`
- Vite：**5280** / `127.0.0.1` / `/api` → `3001`

### 1.4 双 Agent

#### 悬停

- `POST /explain` · `/explain/stream`（`hover | click`）
- Prompt：`buildHoverSystem`（2–3 句、≤220 字）
- 净化：`@agentforge/shared`（`extractHoverAnswer` 等）
- L2：`HoverExplainCache`，键前缀 **`v7`**，TTL 2h / 热 24h（hits≥8）
- L1：前端 `hoverExplainCache.ts`
- `POST /cache/clear`：**admin**

#### 面板

- `POST /chat` · `/chat/stream`（`fast | deep`，无产品化模式选择器）
- `buildDeepSystem`：Thought / Explain / Practice / Next（**非真 tool-loop**）
- 会话持久化 + 滚动摘要；匿名 7 天 TTL
- 记忆启发式写入；`POST /progress`
- maxTokens：fast ≈500–700；deep ≈2048

### 1.5 动画

- `VisualKind` 8 种；`TEMPLATE_KIND` 覆盖作者模板 + 种子扩展 id；未知 → `timeline`
- `SceneCanvas` + `useAnimationPlayer` + 作者模板列表见 shared `ANIMATION_TEMPLATES`

### 1.6 安全

见 `docs/security.md`：bcrypt 12、JWT access、CORS、helmet、限流 120/20/40、Zod、DOMPurify、Pino、BYOK 脱敏、`SEED_ADMIN_PASSWORD` 必填。

### 1.7 种子

- 管理员：`SEED_ADMIN_EMAIL`（默认 `admin@agentforge.local`）+ **必填** `SEED_ADMIN_PASSWORD`（≥8，无兜底）；`adminLevel=100`、`authorTier=elite`；提权需 `SEED_FORCE_ADMIN=1`
- 领域：reasoning / frameworks / protocols / engineering / llm-foundations
- 文章：约 21 篇（`DEFAULT_ARTICLE_SEEDS`）

### 1.8 测试

- `apps/api`：Vitest；`agentPrompt.hover.test.ts`（悬停净化）
- 根 `npm test` → api workspace
- `tests/unit`、`tests/integration`：空目录
- 无前端测试 / 无 E2E / 无 CI 配置

---

## 2. 实现要点（摘要）

1. **悬停净化**：shared 包统一前后端；质检不过不入 L2；缓存键升版本使脏缓存失效（当前 `v7`）  
2. **会话归属**：`ensureConversation` 校验登录用户归属；匿名仅无主会话  
3. **限流分层**：全局 / auth / agent；生产反向代理需显式 `TRUST_PROXY=1`  
4. **流式 LLM**：Anthropic / OpenAI Chat 解析 thinking+text；Responses 流式有限时回退非流式  
5. **动画数据流**：`AnimationDef.steps` → serialize → `buildScene` → `SceneCanvas`

更细的净化分层与 bug 历史见既有实现注释与 `docs/agent-modes.md`。

---

## 3. 未实现清单

### 3.1 Agent / MCP

| 项 | 说明 |
|----|------|
| 真 tool-loop | 无 Tool Call / Observation / 工具状态 SSE |
| 推理模式 UI | 无 `react / plan_execute / …` 选择器 |
| MCP 进程 | 仅 status 探测 |
| 独立 Agent Runtime | `services/agent` 仅 README |
| 批注 API / Agent 审注 | 模型与字段有，路由与调用无 |

### 3.2 内容与社区

| 项 | 说明 |
|----|------|
| 评论 CRUD | 无模型与路由 |
| 话题软删除 UI | 字段有，前端入口弱 |
| 通知 / 站内信 | 无 |

### 3.3 平台工程

| 项 | 说明 |
|----|------|
| Docker / compose | 无 |
| CI | 无 |
| 生产 PostgreSQL 迁移脚本 | 需改 provider + migrate |
| 监控（Sentry 等） | 无 |
| i18n | 中文硬编码 |
| JWT refresh | 无 |

### 3.4 前端体验缺口

| 项 | 说明 |
|----|------|
| 批注 UI | 无 |
| 头像上传 | `avatarUrl` 字段有，无上传 |
| Profile 学习进度可视化 | 弱 |
| 优秀作者申请独立入口 | 审批支持 elite，入口可加强 |

---

## 4. 修改建议（简）

1. **P0 Agent**：最小 tool-loop（`search_articles` / `get_article`）+ 工具状态 SSE  
2. **批注**：补 annotations 路由或删/标注死字段，避免文档与 schema 长期漂移  
3. **安全**：评估短时 JWT + refresh，或文档明确 localStorage token 风险  
4. **CORS**：考虑将 `app.ts` 默认 origin 改为 `5280`，与 `.env.example` 一致  
5. **测试**：扩展悬停净化边界；补 `ensureConversation` 归属用例；加一条注册→发文 e2e  
6. **部署**：最小 `Dockerfile` + 可选 Postgres compose  

---

## 5. 进度概览

```
平台 / 鉴权 / 内容管理           ██████████ 100%
读者体验（首页/搜索/话题/资讯） ██████████ 100%
作者端（CMS + 动画编辑器）      ██████████ 100%
种子内容（约 21 篇 + 动画）     ██████████ 100%
悬停 Agent（快讲 + 缓存 + 净化）██████████ 100%
面板 Agent（会话 + 记忆 + 流式）██████░░░░  60%（无 tool-loop / 模式切换）
MCP / 独立 Runtime              █░░░░░░░░░  10%
批注 / 评论                     █░░░░░░░░░  10%
测试 / 监控 / 部署              ██░░░░░░░░  20%
```

> 百分比为基于代码覆盖度的主观评估，仅作排序参考。
