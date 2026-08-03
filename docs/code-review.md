# AgentForge 代码审查报告

> **归档说明**：本稿为 2026-07-23 时点审查快照，**不随代码持续维护**。当前实现状态请读 `docs/dev-progress.md`、`docs/architecture.md`。后续复查见 `docs/code-review-2026-08-02.md`。

> 审查日期：2026-07-23
> 范围：`apps/api/src`、`apps/web/src`、`apps/api/prisma/schema.prisma`、`packages/shared/src`、`services/*`、`docs/*`
> 方法：静态阅读 + 路径搜索（未运行、未修改代码）
> 阅读对象总行数：约 14 700 行 TS/TSX（含前端后端；不含 `node_modules` 与 `dist`）
> 严重度：🔴 严重（可能造成安全/正确性问题） / 🟠 高（可观察的可靠性/可维护性问题） / 🟡 中（代码气味/可读性） / 🟢 低（建议性）

---

## 0. 审查摘要

| 维度 | 总评 | 关键风险 |
|------|------|----------|
| 代码质量 | 🟠 中等 | `AgentFloat.tsx` 1240 行单体；多处相同净化逻辑在前/后端重复；不少 `console.error` 残留；几乎无单元测试 |
| 架构 | 🟡 良好 | 模块边界清晰；与目标架构存在已知缺口（tool-loop、MCP、独立 Runtime）；前后端契约未用 OpenAPI/类型生成同步 |
| 安全 | 🟠 中等偏上 | 鉴权/RBAC/限流/Zod/DOMPurify 落实到位；但 `articles.ts` SQL `contains` 查询未转义；`@/components/agent/agent.tsx` 暂无批注/路由但模型已有；JWT `alg` 未显式；前端 `localStorage` 存 token 缺乏 CSRF/HttpOnly 妥协说明 |

总计 28 条发现（🔴 4 / 🟠 11 / 🟡 9 / 🟢 4）。

---

## 1. 代码质量

### 1.1 文件 / 函数复杂度

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| Q-01 | `apps/web/src/components/agent/AgentFloat.tsx` | 🟠 高 | 1240 行单体，35+ 个 `useRef`/`useState`；一个组件同时承担悬停 tip、面板聊天、流式中止、节流、限速、缓存、键位、外观。建议拆分为 `useHoverTip`、`useAgentPanel`、`useHoverThrottle` 三块 + 子组件 |
| Q-02 | `apps/api/src/lib/llm/agentPrompt.ts` | 🟠 高 | 678 行；6 个独立的正则常量（`SYSTEM_ECHO / TASK_ECHO / SELF_REVISION / SELF_TALK_PHRASE / PLANNING_HINT / HOVER_META`）散落且有交叉；净化逻辑易在不同分支改一边忘改另一边（bug-1 → 4 历史可见） |
| Q-03 | `apps/web/src/lib/hoverExplainCache.ts` | 🟠 高 | 264 行；与 `agentPrompt.ts` 重复实现 `isSelfTalkSentence / cleanDraftPart / stripSelfRevision` 等。前后端相同规则不同源——一旦后端升 `v5::` 前端未必对齐 |
| Q-04 | `apps/api/src/routes/agent.ts` | 🟠 高 | 885 行单文件；同时承担 hover/click、面板、流式、会话、记忆、进度、缓存清理。建议按子域拆 `agentHover.ts / agentChat.ts / agentMemory.ts` |
| Q-05 | `apps/web/src/pages/SettingsPage.tsx` | 🟡 中 | 463 行单页，14 个 `useState`；BYOK + 外观 + 缓存测试三类关注点混合。建议拆 `<ByokSection/>`、`<AppearanceSection/>` |
| Q-06 | `apps/api/src/lib/llm/providers.ts` | 🟡 中 | 540 行内联流式解析（SSE 行、JSON 解析、降级）；三种 Provider 格式在 `streamAnthropicMessages / streamOpenAiChat` 各自实现，但 `streamOpenAiResponses` 退化到非流式。建议抽出 `parseAnthropicSSE / parseOpenAiSSE` 工具 |

### 1.2 错误处理

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| Q-07 | 多处 `routes/*.ts` | 🟡 中 | `try/catch (e) { next(e) }` 全部吞掉错误上下文。建议附 `requestId` + `logger.error({ err, route })`，便于排障 |
| Q-08 | `apps/api/src/lib/llm/providers.ts:230-231` | 🟠 高 | 流式失败时回退到 `callAnthropicMessages` 非流式，但 `catch {}` 静默；如果非流式也失败则向上抛 `LLM 流式失败 @ ${url}: ${raw.slice(0,240)}`——错误信息含 `baseUrl` 拼接，存在泄漏 `?key=...` 等 query 参数风险（见 S-04） |
| Q-09 | `apps/web/src/lib/agentStream.ts:81-83` | 🟡 中 | `try { JSON.parse(payload) } catch { /* ignore */ }` 静默忽略 SSE 解析错误；长时间流中累积坏包无信号。建议至少上报到 `console.warn` 或埋点 |
| Q-10 | `apps/web/src/hooks/useAuth.tsx:46-51` | 🟡 中 | `ApiError 401/403` 才清 token；其它 4xx/5xx 一律吞。`api.me()` 失败的真实根因（如 404、422）用户看不到。建议把非 401/403 的错误上抛供上层展示 |

### 1.3 一致性与命名

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| Q-11 | `packages/shared/src/index.ts` vs `apps/api/src/routes/agent.ts` | 🟡 中 | `agentMode` / `mode` / `AgentStyle` 等枚举在前后端用 union 字符串重复声明。`shared` 包虽然导出了 `Permission`，但前端 `useAuth` 内对 `Principal` 的复刻（`role / authorTier / adminLevel`）仍是手写。建议前端统一从 `@agentforge/shared` 取 `Principal` 类型 |
| Q-12 | `apps/web/src/components/anim/core/buildScene.ts` | 🟡 中 | `TEMPLATE_KIND` 用 `Record<string, VisualKind>` 而非 `Record<AnimationTemplate, VisualKind>`。`AnimationTemplate` 已在 shared 中定义但未消费 |
| Q-13 | `apps/web/src/components/agent/AgentFloat.tsx:103-106` | 🟢 低 | 局部魔法数（`HOVER_REVEAL_MS = 2000`、`HOVER_MIN_THINK_MS = 420`、`REQUEST_COOLDOWN_MS = 400`、`MAX_REQUESTS_PER_WINDOW = 6`、`REQUEST_WINDOW_MS = 10000`）应集中到 `constants.ts` 便于复审 |
| Q-14 | 命名 | 🟢 低 | 部分文件命名带 `.tmp-xxx` 后缀（如 `apps/web/scripts` 中），建议清理；且与正式 `apps/web/README.md` 的 Vite 模板内容不一致（README 是模板未替换） |

### 1.4 日志 / 调试残留

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| Q-15 | `apps/api/src/index.ts:8`、`seed.ts` 多处、`apps/api/src/middleware/errorHandler.ts:46` | 🟡 中 | `console.log/error` 在生产也会输出；`errorHandler` 兜底 `console.error('[api]', err)` 适合，但其它地方应统一到 `pino` 等结构化日志 |
| Q-16 | `apps/web/src/pages/SettingsPage.tsx:117` | 🟢 低 | `body.apiKey: byokApiKey.trim()` 一律提交即使是空串；后端在 `settings.ts:113` 通过 `apiKey.includes('••••')` 启发式判定"不改 key"，契约靠隐含约定。建议改为显式字段（如 `clearByokKey: true` + `apiKey` 留空才走不变分支），当前实现虽正确但可读性差 |

### 1.5 测试覆盖

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| Q-17 | 整个仓库 | 🟠 高 | 无 `vitest`/`jest`/`playwright`；`apps/api/scripts/` 与 `apps/web/scripts/` 仅遗留 `theme-manager.js` `toc.js` `debug-white-screen.mjs`（无断言）。`extractHoverAnswer / isCompleteHoverAnswer / ensureConversation` 等关键函数没有任何回归用例（2026-08-02 起已接入 Vitest：`apps/api/src/lib/llm/agentPrompt.hover.test.ts` 11 例） |
| Q-18 | `apps/web/src/lib/hoverExplainCache.ts` vs `apps/api/src/lib/llm/agentPrompt.ts` | 🟠 高 | 同一净化规则双实现，前端没法在 CI 拦截「规则漂移」；建议在 `packages/shared/src/sanitize.ts` 抽出统一规则，前后端共用 |

### 1.6 类型安全

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| Q-19 | `apps/api/src/middleware/validate.ts:14` | 🟡 中 | `(req as any)[target] = parsed.data`——`(req as any)` 失去类型保护；建议用 `@types/express` 提供的 `Request<{}, {}, {}, {}>` 泛型扩展，或用 `module augmentation` 替代 `any` |
| Q-20 | `apps/web/src/lib/api.ts` 多处 | 🟢 低 | 返回 `unknown` 的字段（`applications`、`replies.reviewApplication` 等）未收紧；建议至少定义 `AuthorApplication`/`TopicReply` 共享类型 |

---

## 2. 架构

### 2.1 模块边界与依赖

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| A-01 | 整体 | 🟢 低 | 模块依赖单向（web→shared、api→shared、services/ 仅占位）。`apps/api/src/services/` 仅 `serialize.ts`，业务都堆在路由处理器里（5 个 100+ 行路由）。建议抽出 `services/articles.ts` 等业务层，路由仅做 HTTP 装配 |
| A-02 | `apps/api/src/routes/agent.ts` 与 `apps/api/src/lib/llm/` | 🟡 中 | 路由直接操作 `prisma`（消息持久化、记忆 upsert、滚动摘要），同时组装 LLM 调用，业务逻辑与传输层耦合。建议建 `apps/api/src/services/agent/` 收纳会话/记忆/缓存 |
| A-03 | `services/agent/` 与 `services/mcp/` | 🟠 高 | 仅 `README.md`，无 `package.json` / `src/`。与 `docs/agent-modes.md` 的"独立 Agent Runtime"目标脱节，且占用仓库空间让人误以为已就绪。建议要么删目录，要么建空骨架（`package.json` + `src/index.ts` 抛 `not implemented`） |
| A-04 | `apps/api/src/lib/llm/providers.ts` | 🟠 高 | 三家 Provider 的 URL 解析、请求拼装、流式解析都内联。`StreamChunk` 抽象虽合理，但请求体构造散落。建议拆 `anthropic.ts / openaiChat.ts / openaiResponses.ts` 三个 adapter + `providerIndex.ts` 工厂 |
| A-05 | `apps/web/src/lib/api.ts` | 🟡 中 | 单文件导出 40+ API 方法；与后端无 schema 同步机制（手工复制返回类型）。建议从 OpenAPI/zod-to-openapi 生成 `apps/web/src/lib/api.ts` + DTO |

### 2.2 数据模型

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| A-06 | `prisma/schema.prisma` `Annotation` | 🟠 高 | 模型已建（含 `status / reviewBy / reviewerId / agentNote`），但 `apps/api/src/routes/` 完全没有 annotations 路由。前端无批注 UI。用户启用 `allowAgentAnnotationReview` 没有下游处理（死字段）。建议要么删除模型，要么加最小路由 `POST /annotations`、`GET /articles/:slug/annotations?status=approved`、`PATCH /annotations/:id`（仅作者/admin/允许 agent） |
| A-07 | `Article.tags / AnimationDef.steps / AnimationDef.config / User.preferences / AuthorApplication.field` 等 | 🟡 中 | 大量字段以 JSON 字符串存储（`tags`、`steps`、`config`、`preferences` 等），SQL 不可索引/不可聚合，只能用 `contains` 模糊匹配。性能与正确性风险（见 S-01） |
| A-08 | `AnimationDef.steps` 无最大长度校验 | 🟡 中 | `routes/animations.ts` 仅校验 `steps.length`，单 step payload 无大小限制；恶意作者可塞大 JSON 导致数据库膨胀 |
| A-09 | `AgentConversation` 软删除缺失 | 🟢 低 | `Topic` 有 `status='deleted'` 软删除；`AgentConversation` 没有。用户在面板开多个会话会无限累积 |

### 2.3 路由与契约

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| A-10 | `apps/api/src/routes/articles.ts:36-37` | 🟡 中 | `req.query.q` 直接 `String(...).trim()` 后塞进 `contains`，且对通配符（`%`、`_`）无转义；SQLite 用 LIKE 时大量 `%` 会拖慢查询，且 `contains` 在不同方言下语义不一致（Prisma 文档明示）。建议在 Zod 中校验 `q` 最大长度（如 80）并禁用 `%`/`_` |
| A-11 | `apps/api/src/routes/agent.ts:38-39` | 🟠 高 | `selection.text` 最大 4000 字但前端 `AgentFloat.tsx:546` 切 `slice(0, 1200)`、`ArticleCardInlineAgent.tsx:56` 用 `slice(0, 800)`、`ArticlePage.tsx` deepExplain 用 `slice(0, 3500)`——三处不一致。建议服务端明确分级（hover 800 / click 3500），前端写死 |
| A-12 | 缺失契约 | 🟡 中 | 没有 OpenAPI / Swagger；前端 `lib/api.ts` 是手工绑定。引入 `zod-to-openapi` + `swagger-ui-express` 可低成本补齐 |

### 2.4 可扩展性

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| A-13 | Provider 接入路径 | 🟡 中 | 增加新 Provider 需要在 `loadProviders()` 增加一个 `if` 块。建议改为配置驱动（`PROVIDERS_JSON` 环境变量 + 注册表） |
| A-14 | 动画模板 | 🟢 低 | `TEMPLATE_KIND` 是 `Record<string, VisualKind>`，新增模板需要在 4 处（`types.ts ROLE_COLORS` / `buildScene.ts` / `AnimationStep.type` / `shared AnimationTemplate`）同步。建议在 `shared` 中由 union 自动派生 |
| A-15 | 主题/暗色 | 🟢 低 | `useTheme.tsx` 依赖 `localStorage` 单一来源；服务器侧无法强制；与多设备体验割裂。可接受，无需改 |

---

## 3. 安全

### 3.1 鉴权 / 授权

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| S-01 | `apps/api/src/middleware/auth.ts` | 🟢 低 | JWT 校验依赖 `jsonwebtoken.verify`，未显式声明 `algorithms`。`jsonwebtoken` v9 默认会接受 `alg` 头，存在算法混淆历史风险；建议 `jwt.verify(token, secret, { algorithms: ['HS256'] })` |
| S-02 | `apps/api/src/middleware/auth.ts` `optionalAuth` | 🟢 低 | 无效 token 仅 `try/catch` 静默吞；不更新 `req.user`。可接受为产品决策，但应在日志层说明 |
| S-03 | `apps/api/src/routes/agent.ts:114-128` `ensureConversation` | 🟢 低 | 归属校验已实现：匿名仅可访问 `userId=null` 会话，登录用户仅可访问自己会话。✅ |

### 3.2 输入 / 输出

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| S-04 | `apps/api/src/lib/llm/providers.ts:230-231` | 🔴 严重 | 错误信息拼接 `raw.slice(0, 240)`，会带上 BYOK 用户提供的 `baseUrl` 的 `?key=...` query 字符串或响应头。`raw` 直接来自远端，可能含 HTML/堆栈；最终 `AppError.message` 通过 errorHandler 暴露给客户端。建议仅暴露 `status + service`，把原始内容记到服务端日志 |
| S-05 | `apps/web/src/lib/markdown.ts` | 🟢 低 | DOMPurify 白名单（`ALLOWED_TAGS / ALLOWED_ATTR` 扩展 `data-agent-*`）合理。✅ 需定期审计新增 attr |
| S-06 | `apps/web/src/lib/markdown.ts:73-77` | 🟡 中 | 扩展 `ADD_ATTR` 添加了 `target / rel`——若允许文章作者写 `<a target="_blank">` 不带 `rel="noopener"`，可造成 tabnabbing。建议在 sanitize 后再加一道：所有 `<a target="_blank">` 自动补 `rel="noopener noreferrer"` |
| S-07 | `apps/api/src/routes/articles.ts:80-85` | 🟠 高 | `where.OR = [{ title: { contains: q } }, { summary: { contains: q } }, { tags: { contains: q } }]`——SQLite 的 `contains` 会被 Prisma 翻译为 `LIKE '%q%'`，但当 `q` 含 `%` 或 `_` 时会按通配符匹配，导致索引失效甚至越权命中。建议在 Zod 校验中 strip `%` 与 `_`，并加最大长度 |
| S-08 | `apps/api/src/routes/articles.ts:79`、`routes/domains.ts:94` | 🟡 中 | `q` 通过 `String(req.query.q || '').trim()` 兜底读取，未走 `validate(querySchema)`。建议全部走 Zod 校验（已在 `validate.ts` 支持 `target: 'query'`） |
| S-09 | `apps/api/src/routes/agent.ts:782` | 🟠 高 | `streamLlm` 异常路径 `sseWrite({ type: 'error', message })` 把后端异常原文（含内部错误、URL）暴露给前端。建议在 `routes/agent.ts:786` 改为 `message: '生成失败，请稍后再试'`，原错误入服务端日志 |

### 3.3 速率限制 / 资源

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| S-10 | `apps/api/src/app.ts:30-52` | 🟢 低 | 全局/Auth/Agent 三层限流齐备；`app.set('trust proxy', 1)` 处理反向代理；✅ |
| S-11 | `apps/api/src/routes/agent.ts:447-456` | 🟡 中 | `setHoverCache` 是 fire-and-forget（`void setHoverCache(...)`），但写入前需要查询并 `upsert`。大量并发写入时可能击穿 DB 写池。建议加并发节流（如 LRU + 队列） |
| S-12 | LLM `maxTokens` 上限 | 🟡 中 | 客户端未传时由服务端默认；当前没有"按用户层/请求大小"的差异化限制，可能被滥用。建议给 `anonymous` 单独 lower 限额（如 `fast=80 / deep=512`） |
| S-13 | `apps/api/src/routes/settings.ts:147-181` `POST /test-llm` | 🟡 中 | 测试连通会真实调用 LLM provider；如未限流可被刷量。`settingsRouter` 未挂 `authLimiter`，但 `app.ts:42` 全局限流 120/min 一般够用；建议额外给 `test-llm` 加单点节流（如 5/min） |

### 3.4 BYOK / 密钥

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| S-14 | `apps/api/src/routes/settings.ts:108-125` | 🟡 中 | `byok.apiKey` 通过 `if (apiKey && !apiKey.includes('••••'))` 隐式判断是否需要更新。客户端拿掩码做 placeholder 时若误把掩码原样提交会被"通过校验"。当前 client 端 `SettingsPage.tsx:117` 提交 `byokApiKey.trim()`，但当 `byokHasKey` 时 placeholder 显示 `••••`，理论上用户复制进去会真传回——这是一个边角陷阱。建议显式字段 `updateApiKey: boolean` |
| S-15 | `apps/api/src/routes/settings.ts:122-124` | 🟡 中 | `preferences.byok.apiKey` 直接以明文 JSON 写入 SQLite `User.preferences`。数据库被脱库则全部 BYOK 泄漏。建议至少加密（AES-GCM + 服务端 KEY）或迁移到独立 `ByokKey` 表（列加密） |
| S-16 | `apps/api/src/lib/llm/providers.ts:144` | 🟢 低 | `callLlm` 抛错信息包含 `process.env` 不存在时的 `未配置 LLM` 文案，✅ |
| S-17 | `apps/web/src/lib/apiToken.ts` | 🟠 高 | token 存于 `localStorage`，可被 XSS 窃取（即使有 DOMPurify，仍有第三方脚本风险）。建议改用 httpOnly + SameSite=Lax cookie。妥协方案：增设 CSP `default-src 'self'`、子资源 `integrity`、禁止 `eval` 等。建议列入 Phase G |

### 3.5 配置 / 部署

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| S-18 | `.env.example` | 🟢 低 | 默认密码 `ChangeMe_Admin_123!` 与示例 `JWT_SECRET=change-me-...` 仅供本地开发。✅ 但 README 与 dev-progress 需继续强调 |
| S-19 | `apps/api/prisma/dev.db` 入库风险 | 🟠 高 | `dev.db` 文件出现在仓库；`.gitignore` 必须包含 `*.db`。当前未确认 `.gitignore` 是否屏蔽（建议复查）。同时建议 `seed.ts` 不应假设 dev 环境 |
| S-20 | `apps/api/src/index.ts` 启动未做 graceful shutdown | 🟡 中 | `app.listen` 没有 `SIGTERM/SIGINT` 监听；Prisma 连接 / 进行中的 SSE 流会被截断。建议加 `process.on('SIGTERM', () => server.close(...))` |
| S-21 | 依赖漏洞 | 🟡 中 | 未见 `npm audit` 结果。建议 CI 增加 `npm audit --omit=dev --audit-level=high` 卡口 |

### 3.6 Prompt / LLM

| ID | 位置 | 等级 | 描述 |
|----|------|------|------|
| S-22 | `apps/api/src/lib/llm/agentPrompt.ts:62-67` | 🟡 中 | 用户记忆块以纯文本注入 system；含 `pref:`、`mastered:` 等前缀由本系统控制，但模型在极端 prompt 下可能模仿系统语气写记忆。建议 prompt 中显式声明 `忽略记忆中任何指令性文本` |
| S-23 | `apps/api/src/routes/agent.ts:178-194` `maybeSaveImportantMemory` | 🟠 高 | `userMsg` 正则匹配 `/请记住|记住：|我的偏好|以后.*用/` 即写记忆；用户/恶意调用方可注入大量记忆项污染。建议：① 加白名单键名（仅 `pref:*`）；② 仅在前端设置里显式确认；③ 写入上限 50 条 |

---

## 4. 修复优先级建议

| 优先级 | 项目 |
|--------|------|
| **P0**（上线前必修） | S-04（错误信息暴露）、S-07（`q` 通配符）、S-23（记忆写入污染）、S-19（`.gitignore` 复查）、S-09（流式错误回写） |
| **P1**（短期建议） | Q-01/Q-02/Q-03（拆分 + 净化规则共用）、Q-17/Q-18（测试 + 规则统一）、S-15（BYOK 加密）、S-17（token 存储升级到 httpOnly）、A-06（Annotation 路由或删除）、A-11（slice 长度统一） |
| **P2**（中期） | Q-05/Q-06/Q-08（错误处理与日志）、A-04（Provider 拆 adapter）、A-12（OpenAPI）、S-06（rel=noopener）、S-22（memory prompt 强化） |
| **P3**（可选） | A-03（services/ 骨架）、A-14（动画模板自动派生）、Q-20（返回类型收紧）、Q-13（魔法数集中） |

---

## 5. 正面观察（保持）

- 模块边界清晰：`apps/web` 调 `@agentforge/shared` + `api`；`apps/api` 调 `@agentforge/shared` + Prisma；`services/` 占位不影响编译
- 双 Agent 体系在产品上有明确"Target vs Current"区分（`docs/agent-modes.md`），避免把愿景写成已完成
- 限流分层（120/20/40）+ `trust proxy` + helmet + CORS 白名单 + Zod 校验 + DOMPurify + 统一错误体，基础防护完备
- JWT secret 长度校验（≥16）、bcrypt cost 12、refresh token 机制已具备（虽未在路由中使用，需确认）
- BYOK 设计有"客户端不回传完整 key"的契约（`publicByok`），且服务端默认 Provider 仅返回 `baseUrlHost`
- 悬停答案净化历经 4 次 bug 修复，留下版本前缀 `v5::` 与质检 `isCompleteHoverAnswer`，是可复用的工程实践

---

## 6. 验证手段建议（不上代码）

| 维度 | 推荐工具/命令 |
|------|---------------|
| 类型 | `npm run build`（已具备 workspace 串联 build） |
| Lint | `npm run lint`（已声明 `--workspaces --if-present`） |
| 测试 | 引入 `vitest`，覆盖 `extractHoverAnswer / isCompleteHoverAnswer / ensureConversation / publicByok` |
| 安全 | `npm audit --omit=dev --audit-level=high`；OWASP ZAP baseline scan；`semgrep` JavaScript 规则集 |
| 性能 | `k6` 或 `autocannon` 跑 `GET /articles` 与 `POST /agent/explain` |
| 契约 | `zod-to-openapi` + Swagger UI；前端用 `openapi-typescript` 生成 client |

---

## 7. 审查方法附录

本次审查仅做静态阅读与路径搜索，未执行代码、未跑测试、未连接 LLM Provider。所有结论均可由所列文件与行号复现。