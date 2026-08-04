# 架构与设计审查报告

> 审查日期：2026-08-04
> 审查范围：整体架构、分层设计、数据流、安全设计、可维护性、文档一致性
> 审查性质：**只读审查，未修改任何代码**
> 证据基准：仓库代码（commit `224cfdb`）+ 直接核验

---

## 0. 总体评价

AgentForge 是一个**架构清晰、工程纪律好、安全意识扎实**的中型 monorepo 项目。分层取舍有意为之，安全实现到位（JWT 轮换、BYOK AES-256-GCM、SSRF 策略、流式中断、错误脱敏均有测试覆盖）。审查驱动的重构痕迹明显（A-01~D-05、I1~I5、B-01~B-11 编号注释贯穿），代码可追溯性高。

主要问题集中在三个维度，**均非结构性缺陷，属可增量改进项**：

| 维度 | 评价 | 核心短板 |
|------|------|----------|
| 分层与组织 | **良好** | `agent.ts`(722行) 过胖；`AgentFloat.tsx`(914行) 巨型组件；fat-handler 无统一业务层（当前规模合理） |
| 安全设计 | **扎实** | token 存 localStorage（XSS 可窃取）；SSRF 无 DNS 二次校验；Observation 注入未消毒 |
| 文档一致性 | **一般** | 4 处文档与代码不一致；`_legacy/` 治理矛盾；`.env.example` 误导 |

**严重程度分级**：🔴 Critical（阻断/数据损失）· 🟠 Important（应修）· 🟡 Minor（建议）· 🔵 观察（取舍说明）

---

## 1. 项目结构与 Monorepo 组织

### 1.1 顶层结构

```
AgentForge/
├── apps/api/        # 后端（Express 5 + Prisma 6 + SQLite）—— 活跃
├── apps/web/        # 前端（Vite 8 + React 19）—— 活跃
├── packages/shared/ # 共享类型 + 权限矩阵 + 悬停净化 —— 活跃，被 api/web 共用
├── services/agent/  # 仅 README，独立 Runtime 预留
├── services/mcp/    # 仅 README，MCP 预留
├── api/             # 空目录（死代码）
├── _legacy/         # 旧静态站，46 文件仍被 git 跟踪
├── docs/            # 文档
└── tests/           # 集成/单元测试目录（内容见 §6）
```

npm workspaces（`apps/*` + `packages/*`）边界正确，workspace 互引通过 `@agentforge/shared`。

### 1.2 死代码与遗留治理问题

#### 🟠 D-01：根 `api/` 空死目录

`find api -type f` 返回 0 个文件，无任何 import 或 package.json 引用。`docs/architecture.md:19` 已注明"若存在空壳 `api/`，以 `apps/api` 为准，勿混用"——但文档在"打补丁"而非"清理"。

**建议**：直接删除根 `api/` 目录。

#### 🟠 D-02：`_legacy/` 治理矛盾（文档与实际不符）

这是**文档说谎**的典型案例：

- `docs/architecture.md:17` 声称 `_legacy/` "已迁入；`.gitignore` 忽略"
- `.gitignore:14` 确有 `_legacy` 规则
- **实际**：`git ls-files _legacy | wc -l` = **46 个文件仍被 git 跟踪**

`.gitignore` 对已跟踪文件无效。这些旧静态 HTML/JS/CSS（含 Tailwind CDN 原型）仍占仓库体积，且 README 的"已忽略"陈述与事实矛盾，易误导新人。

**建议**：`git rm --cached -r _legacy` 后，`.gitignore` 规则才真正生效；或若需保留历史参考，明确改为"归档保留，不在构建链中"并修正文档措辞。

#### 🟡 D-03：`services/` 是纯文档占位

`services/agent/README.md` + `services/mcp/README.md`，无任何 `.ts` 代码或 `package.json`。`app.ts:89-95` 的 `/api/v1/mcp/status` 返回 `status:'reserved'`。README 已澄清"站内 Agent 已在 apps/api 实现"，属有意预留。**可接受**，但顶层 `services/` 目录名易被误读为已运行的微服务。

**建议**：在 README/architecture.md 更显眼处标注"规划中，非运行代码"（当前已有但可强化）。

#### 🟡 D-04：`tests/` 目录角色模糊

根目录 `tests/integration/` 与 `tests/unit/` 存在，但实际测试分散在 `apps/api/src/**/*.test.ts`（10 个文件）与 `packages/shared/src/smoke.test.ts`。CI 只跑 `npm test --workspace=@agentforge/api` 与 shared。需核验 `tests/` 是否在用——若为空壳，同 D-01 处理。

---

## 2. 后端架构（apps/api）

### 2.1 分层模式：fat-handler + Agent 专属服务层

后端采用**有意取舍的分层**：

- **CRUD 路由**（articles/domains/topics/annotations/applications/animations）：无 controller / 无 repository，handler 内联"Zod 校验 → prisma 查询 → 业务判断 → serialize 序列化 → res.json"。
- **Agent 路由**：拆出 `services/` 编排层（`agentOrchestrator.ts` / `agentConversation.ts` / `agentMemory.ts` / `hoverCache.ts`）。
- **基础设施**：`lib/`（prisma/logger/errors/hash/jwt/sse）+ `lib/llm/`（provider 适配子包）。

**评价**：对当前规模，简单 CRUD 不抽象服务层是合理的——"Senior Test"会通过。但若 CRUD 增长（如 articles.ts 已 321 行），需考虑抽薄。这属架构取舍，非缺陷。

### 2.2 中间件链

`apps/api/src/app.ts` `createApp()` 挂载顺序：

```
trust proxy（显式开关）→ helmet → cors（白名单+credentials）→ express.json(1mb)
→ requestId → 请求日志 → generalLimiter(120/min)
→ /health → 各路由（auth 20/min、agent 40/min 独立限流）→ errorHandler
```

**评价**：顺序合理，errorHandler 最后挂载。`trust proxy` 默认关闭、显式开启防 XFF 伪造，安全意识到位。

#### 🟡 D-05：`agent.ts` 路由过胖（722 行）

`/explain/stream` 与 `/chat/stream` 两个 SSE 路由的流控逻辑高度相似（早停、abort 联动、safeThinking 累积、isSystemEcho 门控）。虽已将编排逻辑拆到 `agentOrchestrator.ts`，但 SSE 帧处理仍内联在路由中。

**建议**：抽取 `lib/sse.ts` 的流式循环辅助函数，统一两个 SSE 路由的帧处理模板。旧 code-review C-03 已记录 `/chat/stream` 的客户端断开 abort 问题（现已补 `req.on('close')`），但结构重复仍在。

### 2.3 认证与授权

**JWT 实现**（`lib/jwt.ts`）：access（15m）+ refresh（7d，sha256 入库，旋转吊销用 `updateMany` 原子操作防重放）。`secret()` 强制 `JWT_SECRET ≥16` 字符。

**中间件四件套**（`middleware/auth.ts`）：`optionalAuth` / `requireAuth` / `requireRole(...roles)` / `requirePermission(...perms)` / `requireAdminLevel(min)`。权限矩阵单一真相源在 `packages/shared/src/permissions.ts`（3 角色 + 13 Permission）。

**评价**：认证授权设计扎实，组合式中间件清晰。`AuthUser` 通过 `declare global Express.Request` 注入 `req.user`，符合 Express 惯例。

### 2.4 Prisma Schema

13 个 model，0 个 enum（角色/状态均为 `String` + 注释）。索引设计充分，外键删除策略统一（Cascade 业务实体、SetNull 可空引用）。

#### 🟡 D-06：无 enum，角色/状态用字符串

角色（`reader`/`author`/`admin`）、状态（`pending`/`approved`/`rejected`）等均为 `String`，靠应用层校验。Prisma enum 可在数据库层约束，但 SQLite 对 enum 支持有限（Prisma 会编译为 String）。**属可接受的取舍**，但需确保应用层 Zod 校验覆盖所有写入点。

### 2.5 数据库：SQLite 默认 + PostgreSQL 可选

`schema.prisma` datasource 为 `sqlite`，`docker-compose.yml` 提供 PostgreSQL 16。`docs/postgres.md` 有切换步骤。

#### 🔵 D-07：生产数据库选型

SQLite 单文件、无并发写、无网络——适合开发与单机小规模部署。生产建议切 PostgreSQL（文档已说明）。需注意：SQLite 与 PostgreSQL 的 Prisma 行为差异（如大小写敏感、事务隔离级别）需在切换时回归测试。

---

## 3. 前端架构（apps/web）

### 3.1 分层：pages / components / hooks / lib 四层

- `pages/`：页面编排（数据加载 + 组合组件）
- `components/`：`ui/`（原子）+ 领域组件（`agent/` `article/` `anim/` `domain/` `home/` `layout/`）
- `hooks/`：带 React 状态的封装（`useAuth` `useTheme` `useAgentPanel` 等）
- `lib/`：纯逻辑（`api` `apiToken` `agentStream` `hoverExplainCache` `markdown` 等）

**评价**：四层职责分明，单向依赖，无交叉污染。`lib/` 是纯逻辑无 UI，`hooks/` 是带状态的封装，边界清晰。

### 3.2 状态管理：纯 Context + hooks，无第三方库

仅两个全局 Context：`useAuth`（user/loading + 派生 isAuthor/isAdmin）与 `useTheme`（light/dark + 6 色调色板）。Agent 面板会话状态是局部的（`useAgentPanel` 内部 `useState`），符合"作用域最小化"。

**评价**：对当前规模合理，无过度工程。

### 3.3 数据流：单一出口

- `lib/api.ts`（442 行）：统一 `request<T>()` 封装，token 自动注入、15s 超时、401 单飞 refresh + 重试、错误归一为 `ApiError`。~30 个方法覆盖全部 REST API。
- `lib/agentStream.ts`：SSE 专用，`streamAgent()` 手动解析 `data:` 行，28s 独立超时。

**评价**：数据出口单一、封装干净。SSE 与 REST 分离合理（流式不走 `request` 封装）。

### 3.4 关键问题

#### 🟠 D-08：无代码分割（React.lazy / Suspense）

`grep React.lazy|Suspense` 全空。`router.tsx` 顶部静态 import 全部 ~20 个页面，首屏即全量打包。author 编辑器（345 行）、Settings（474 行）、admin 页都进首屏 bundle。

**影响**：首屏体积偏大，尤其 author/admin 路由对普通读者无用却仍加载。
**建议**：按路由懒加载，`React.lazy` + `<Suspense fallback>`。

#### 🟠 D-09：无 ErrorBoundary

`grep ErrorBoundary|componentDidCatch` 全空。任何渲染异常会让整树白屏，无降级 UI。

**建议**：在 `AppShell` 外包一层 `ErrorBoundary`，至少给用户"出错了，刷新"的反馈。

#### 🟠 D-10：鉴权模式重复且不够健壮

无路由级 `loader` / 守卫组件。受保护页面在组件体内内联守卫：

```tsx
const { loading, isAdmin } = useAuth();
if (loading) return <加载中/>;
if (!isAdmin) return <提示/>;
```

此模式在 `DomainsAdminPage`、`AnimationEditorPage`、`ArticleEditorPage`、`ApplicationsAdminPage` 等多处重复，且**鉴权前会短暂渲染受保护内容骨架**（后端有权限校验兜底，无安全漏洞，但 UX 不佳）。

**建议**：提取 `<RequireRole role="admin">` 守卫组件，或用 React Router 7 的 `loader` + `redirect`。

#### 🔴 D-11：Token 存 localStorage（XSS 可窃取）

`lib/apiToken.ts`：access + refresh 令牌均存 `localStorage`，前端 JS 可读。XSS 攻击可窃取令牌（尤其 refresh 7 天有效）。

项目对此**有意识但未实施**：
- `docs/security.md:44` 明确列为"未实现/待办"
- `docs/httponly-cookie-migration.md` 已有迁移方案
- `architecture.md:26` 注明"HttpOnly Cookie 迁移见专门文档"

**建议**：优先将 refresh token 迁移至 httpOnly cookie（方案已备），access token 可保留内存（刷新时从 cookie 取）。这是**安全优先级最高**的改进项。

#### 🟠 D-12：`AgentFloat.tsx` 巨型组件（914 行）

悬停气泡逻辑 + Agent 面板 UI 混在一个组件，含 7+ ref 定时器、世代计数（genRef）、节流/限流窗口。虽已将状态机抽到 `lib/hoverExplainSession.ts`，组件本身仍偏重。

**建议**：拆分为 `HoverTip`（悬停气泡）+ `AgentPanel`（面板）两个组件，悬停逻辑进一步抽 hook。注意：用户明确要求**不改动前端视觉效果**，此重构应保持视觉一致。

#### 🟡 D-13：内联样式偏多

`AppShell`、`AgentFloat` 大量 `style={{}}` 直接引用 `var(--xxx)`，削弱了 `tokens.css` 设计令牌的集中管理优势。属可维护性问题，非功能缺陷。

---

## 4. LLM / Agent 架构

### 4.1 Provider 抽象

统一入口 `lib/llm/providers.ts`：`callLlm` / `streamLlm` / `resolveProvider`（BYOK 优先 → 服务端 env）。类型契约 `types.ts`，参数单一真相源 `config.ts`。三种 adapter：

| 维度 | anthropic_messages | openai_chat | openai_responses |
|------|:-:|:-:|:-:|
| 同步 callXxx | ✅ | ✅ | ✅ |
| 真流式 streamXxx | ✅ | ✅ | ❌ 退化整段 |
| signal 传递 | ✅ | ✅ | ✅ |
| vision 多模态 | ✅ | ✅ | ❌ |
| thinking 字段 | ✅ | ✅ | ❌ |
| usage 统计 | ✅ | ❌ | ❌ |
| thinking-disabled 回退 | ✅ 400/422 重试 | ❌ | ❌ |

#### 🟠 D-14：`openai_responses` 是二等公民

`streamLlm` 对 `openai_responses` 明确 warn"未实现真流式，退化为整段输出（早停无效）"（`providers.ts:254`）。无 vision、无 thinking、无 usage、无 thinking-disabled 回退。

**影响**：若用户 BYOK 选此格式，体验降级（无流式、无思考展示）。默认服务端 Provider 是 StepFun（`anthropic_messages` 格式），故默认路径不受影响。
**建议**：补齐真流式，或在 Provider 元数据中明确标注降级特性，让用户知情。

### 4.2 流式与中断处理：健壮

- **SSE 选型**（非 WebSocket）：合理，无 WS 复杂度。
- **双层 abort**：后端 `req.on('close')` → `llmAbort.abort()`；`withTimeout` 合成 30s 超时 signal；adapter reader 每轮检查 `req.signal?.aborted` 并 `reader.cancel()`。前端 `streamAgent` 用 `AbortController` + 外部 signal 合成，28s 超时比后端 30s 短（先超时避免悬挂）。
- **isSystemEcho 门控**：per-delta 逐片过滤 + final 兜底，`safeThinking` 累积已展示的安全思考。
- **先持久化再发 final**：`/chat/stream` 非 react 分支 `await finalizeChatTurn(...)` 在 `sseWrite({type:'final'})` 之前——避免 persist 失败用 error 覆盖已交付答案。

**评价**：流式与中断处理是项目最扎实的部分，审查驱动的修复（A-04/I3/I5）全部落实并有测试。

### 4.3 Tool Loop：prompt-based 实现

`lib/llm/tools/toolLoop.ts` 的 `runToolLoop`：模型输出 `TOOL_CALL: {...}` → 正则解析 → 白名单 + Zod 校验 → 执行 → Observation 拼回 messages。护栏：白名单（仅 `search_articles`/`get_article`）、每工具 8s 超时、最多 5 轮、pino 审计。

#### 🟠 D-15：Observation 注入未消毒

`toolLoop.ts:133` 将工具返回的 markdown 直接拼进 `messages`：

```ts
messages.push({
  role: 'user',
  content: `Observation (${toolCall.name}):\n${exec.observation}`,
});
```

文章内容由 author 角色写（半信任），理论上可构造内容冒充系统指令（prompt injection）。`tool-loop-roadmap.md` P1 已明确"Observation 注入防御（长度上限/敏感字段剥离/防工具结果冒充系统指令）"为待办。

**建议**：P1 安全优先项——对 Observation 加长度上限（已有 4000 字截断在 preview，但拼入 messages 的全文未截断）、用明确分隔符标记、剥离类系统指令的文本。

#### 🟡 D-16：tool-loop 无独立限流

当前与普通 chat 共享 `agentLimiter`（40/min）。`tool-loop-roadmap.md` P1 列"tool-loop 独立限流"为待办。ReAct 多轮调用放大了 LLM 请求量，独立限流更合理。

### 4.4 BYOK 加密：设计扎实

`lib/byokCrypto.ts`：AES-256-GCM，密文前缀 `enc:v1:`，密钥派生 `SHA256("byok-encryption-v1:" + (BYOK_ENCRYPTION_KEY||JWT_SECRET))`。`resolveByokApiKeyToStore` 正确处理二次保存（解密旧密文再存，避免对密文再加密）。解密失败返回空串（绝不外泄密文为明文）。测试覆盖完整。

#### 🟡 D-17：BYOK 密钥轮换无自动机制

`docs/security.md:55` 已警告：轮换 `BYOK_ENCRYPTION_KEY` 或 `JWT_SECRET` 后，历史密文无法解密，BYOK 静默回退服务端默认（用户无感知）。依赖手动重填或先清空。**属已知限制，文档已记录**。

### 4.5 SSRF 防护

`lib/byokUrlPolicy.ts`：仅约束 BYOK baseUrl（禁止私网/环回/metadata/CGNAT/.local 后缀），服务端 env Provider 不受限。

#### 🟡 D-18：SSRF 无 DNS 二次校验

基于 hostname 字符串解析，未做 DNS 解析后的 IP 二次校验。攻击者可用自建 DNS 把公网域名解析到 `169.254.169.254` 绕过（DNS rebinding）。对 BYOK 场景（用户自带 key 调自己的网关）风险可控，但严格说非完整 SSRF 防护。

**建议**：若 BYOK 面向不可信用户，补 DNS 解析后 IP 校验；当前场景可接受但应文档标注限制。

---

## 5. 文档一致性

### 5.1 文档与代码不一致

#### 🟠 D-19：README CORS 说明过时

`README.md:39` 声称"代码硬编码默认仍为 `5173`，未配 env 时会不匹配"。
**实际**（`app.ts:27`）：`process.env.CORS_ORIGIN || 'http://localhost:5280'`——默认已是 `5280`，与 Vite 端口一致。

文档落后于代码，会误导用户以为不配 env 就会出错（实际不会）。

#### 🟠 D-20：`.env.example` 的 `VITE_API_BASE_URL` 误导

`.env.example` 写 `VITE_API_BASE_URL=http://localhost:3001/api/v1`（直连后端）。
**实际** `apps/web/.env` 是 `VITE_API_BASE_URL=/api/v1`（走 Vite 代理）。

若用户照 `.env.example` 配置，前端会绕过 Vite 代理直连 `:3001`，开发期可能遇 CORS 问题（虽 CORS 已允许 5280，但直连会带 `Origin: http://localhost:5280`，理论上能过——但语义上应统一走代理）。

#### 🟠 D-21：`architecture.md` 两处过时

- **`:17`**：声称 `_legacy/` "已迁入；`.gitignore` 忽略"——实际 46 文件仍被 git 跟踪（见 D-02）。
- **`:71`**：声称 `Annotation` "模型已有，尚无 API 路由"——实际 `routes/annotations.ts` 已实现 GET/POST/PATCH（`app.ts:87` 挂载）。`security.md:46` 倒是已标注 `[x]` 实现了，两份文档自相矛盾。

#### 🟡 D-22：`PLAN.md` 自承过时

`PLAN.md` 开头注明"§1–§6 保留早期产品意图；其中『Agent 本次不实现 / 返回 501』等表述已被后续实现取代，以 architecture.md 与代码为准"。虽已加免责声明，但保留过时内容仍增加认知负担。

**建议**：统一文档更新机制——代码变更时同步刷新对应文档；或定期做一次"文档对账"（类似 `67d2079` commit 做过的）。

---

## 6. 测试

### 6.1 现状

11 个测试文件，约 1382 行，覆盖核心安全与净化逻辑：

| 文件 | 覆盖范围 |
|------|----------|
| `jwt.test.ts` | 令牌签发/验证/refresh 旋转 |
| `byokCrypto.test.ts` | 加密/解密/二次保存/密钥轮换 |
| `byokUrlPolicy.test.ts` | SSRF 策略 |
| `agentPrompt.hover.test.ts` | 悬停 prompt + 答案门控 |
| `providers.test.ts` | provider 抽象 + 超时/abort |
| `tools.test.ts` | tool-loop 解析/执行 |
| `agent.sse.test.ts` | SSE 流式端点 |
| `agentConversation.test.ts` | 会话生命周期/guestKey ACL |
| `annotationAcl.test.ts` | 批注可见性 ACL |
| `hoverCache.test.ts` | L2 缓存 |
| `shared/smoke.test.ts` | 共享包冒烟 |

CI（`.github/workflows/`）：build shared → API 单测 → shared 单测 → web typecheck/build → api build。

### 6.2 评价

**优点**：安全关键路径（JWT/BYOK/SSRF/净化/ACL）均有测试，审查修复（I1~I5）有回归覆盖。这是从早期"零测试"状态的显著进步。

#### 🟡 D-23：路由集成测试薄弱

当前测试集中在 `lib/` 与 `services/` 单元层，路由层集成测试仅 `agent.sse.test.ts`。articles/domains/topics/annotations 等 CRUD 路由无集成测试，权限矩阵（`requireRole`/`requirePermission`/`requireAdminLevel`）的端到端验证缺失。

**建议**：补充路由级集成测试（supertest + 内存 SQLite），重点覆盖权限边界（reader 不能写、author 不能管域等）。

---

## 7. 横切关注点

### 7.1 日志

Pino 结构化日志，生产 JSON、开发 pretty。请求 ID 贯穿 errorHandler。LLM 错误的 `diagnostic`（url/raw）只进日志、客户端只见安全文案（A-01 脱敏）。**设计合理**。

### 7.2 错误处理

`errorHandler.ts` 统一映射 `AppError` / ZodError / Prisma P2002·P2003·P2025。500 不暴露堆栈。handler 统一 `try/catch → next(e)`。LLM 错误经 `llmError()` 映射为 `AppError(502, 'LLM_ERROR')`。**设计合理**。

### 7.3 限流

三级限流：全局 120/min、鉴权 20/min、Agent 40/min。`/settings/test-llm` 独立 40/min 防 Agent 绕过。**设计合理**。

### 7.4 配置管理

环境变量集中在 `.env`，`.env.example` 提供模板。`JWT_SECRET` 强制 ≥16 字符，`SEED_ADMIN_PASSWORD` 必填 ≥8 字符无兜底。`TRUST_PROXY` 显式开关。**设计合理**（除 D-20 的 `.env.example` 误导）。

---

## 8. 问题汇总与优先级

### 🔴 Critical（安全优先）

| 编号 | 问题 | 位置 |
|------|------|------|
| D-11 | Token 存 localStorage，XSS 可窃取 refresh（7d 有效） | `apps/web/src/lib/apiToken.ts` |

### 🟠 Important（应修）

| 编号 | 问题 | 位置 |
|------|------|------|
| D-15 | Tool-loop Observation 注入未消毒（prompt injection 风险） | `lib/llm/tools/toolLoop.ts:133` |
| D-08 | 无代码分割，首屏全量打包 | `apps/web/src/app/router.tsx` |
| D-09 | 无 ErrorBoundary，渲染异常白屏 | `apps/web/src/`（全局缺失） |
| D-10 | 鉴权模式重复，无守卫组件/loader | 多个 page 组件 |
| D-14 | `openai_responses` 无真流式/vision/thinking（二等公民） | `lib/llm/providers.ts:250` |
| D-02 | `_legacy/` 46 文件仍被 git 跟踪，文档声称已忽略 | `_legacy/` + `docs/architecture.md:17` |
| D-19 | README CORS 说明过时（称默认 5173，实际 5280） | `README.md:39` |
| D-20 | `.env.example` 的 `VITE_API_BASE_URL` 与实际不符 | `.env.example` |
| D-21 | `architecture.md` 两处过时（_legacy / Annotation API） | `docs/architecture.md:17,71` |
| D-12 | `AgentFloat.tsx` 914 行巨型组件（保持视觉不变前提下拆分） | `apps/web/src/components/agent/AgentFloat.tsx` |

### 🟡 Minor（建议）

| 编号 | 问题 | 位置 |
|------|------|------|
| D-01 | 根 `api/` 空死目录 | `api/` |
| D-03 | `services/` 纯文档占位易误读 | `services/` |
| D-04 | `tests/` 目录角色需核验 | `tests/` |
| D-05 | `agent.ts` 722 行，SSE 双路由逻辑重复 | `apps/api/src/routes/agent.ts` |
| D-06 | 无 enum，角色/状态用字符串（可接受取舍） | `schema.prisma` |
| D-13 | 内联样式偏多 | `AppShell` / `AgentFloat` |
| D-16 | tool-loop 无独立限流 | `toolLoop.ts` |
| D-17 | BYOK 密钥轮换无自动机制（已知限制） | `byokCrypto.ts` |
| D-18 | SSRF 无 DNS 二次校验 | `byokUrlPolicy.ts` |
| D-22 | `PLAN.md` 自承过时仍保留 | `PLAN.md` |
| D-23 | 路由集成测试薄弱 | `apps/api/src/routes/` |

### 🔵 观察（架构取舍说明，非缺陷）

| 编号 | 说明 |
|------|------|
| D-07 | SQLite 默认 + PostgreSQL 可选，生产需切换（文档已说明） |
| — | fat-handler 无统一业务层：当前规模合理，CRUD 增长时再抽 |
| — | prompt-based tool-loop 而非原生 function-calling：P0 阶段合理，roadmap 已规划演进 |

---

## 9. 架构亮点（值得保持）

1. **Monorepo 边界正确**：`apps/api` / `apps/web` / `packages/shared` 职责分明，共享逻辑（权限矩阵、悬停净化）单一真相源。
2. **LLM 子包内聚**：`lib/llm/` 把 provider 适配/prompt 构建/tool-loop 封装干净，`config.ts` 是参数单一真相源。
3. **流式中断双层 abort**：req.close + llmAbort + withTimeout + reader.cancel，健壮。
4. **审查驱动重构可追溯**：A-01~D-05、I1~I5、B-01~B-11 编号注释贯穿，代码可读性与可追溯性高。
5. **安全实现扎实**：bcrypt 12 轮、refresh sha256 入库+原子吊销、BYOK AES-256-GCM、SSRF 策略、LLM 错误脱敏、seed 提权风险已修。
6. **数据出口单一**：前端 `api.ts` + `agentStream.ts` 分别统一 REST 与 SSE，封装干净。
7. **设计系统有 token/主题**：`tokens.css` + 6 色调色板 + 深色模式，无重型依赖。

---

## 10. 建议的改进优先级

若后续实施修改，建议按以下顺序：

1. **D-11**（token → httpOnly cookie）：安全优先级最高，方案已备。
2. **D-15**（Observation 消毒）：tool-loop 安全护栏补齐。
3. **D-02 / D-19 / D-20 / D-21**（文档对账 + 死代码清理）：低成本高收益，消除认知负担。
4. **D-08 / D-09 / D-10**（前端性能与健壮性）：代码分割 + ErrorBoundary + 路由守卫。
5. **D-12**（AgentFloat 拆分）：保持视觉不变前提下重构。
6. **D-14**（openai_responses 补齐或标注降级）。
7. **D-23**（路由集成测试）。

---

> 本报告基于 2026-08-04 仓库状态（commit `224cfdb`）直接核验编写。所有"已核验"结论均有命令/代码佐证；标注"文档声称"处已与代码对比并指出差异。
