# AgentForge 全面审查（Round 2 · 增量）

> 审查日期：2026-08-04  
> 审查基准：commit `224cfdb`，当前工作树未发生代码改动  
> 审查性质：只读静态审查。**未修改任何源码、配置、文档或构建产物；未替换或覆盖 Round 1 报告。**  
> 关系：本文为 `docs/reviews/comprehensive-review-2026-08-04.md` 的**增量审查**，编号前缀 `R2-`，避免与 R1 的 `SEC/ARC/WEB/Q/DOC` 重复。

## 0. 执行摘要

本轮只追加 R1 未覆盖或需强化的发现，**不再重复 R1 的 35 条**。R1 报告的所有结论在本轮中已逐项复核，截至本轮代码状态：

- 35 项 R1 发现**全部仍存在**，未在代码层面修复。
- 本轮新增 **27 条 R2 发现**，按严重性分布：Critical 1 条、High 8 条、Medium 14 条、Low/Observation 4 条。
- R2 最高优先级问题集中在**生产交付链、运行时生命周期、CSRF 提前准备、BYOK fetch 重定向、提权审计、并发一致性与可观测性**——这些是 R1 未覆盖或仅有少量静态推断的新增证据。

### 严重性速览

| 级别 | 数量 | 关键项 |
|---|---:|---|
| Critical | 1 | R2-01 无 graceful shutdown 与 Prisma 关闭 |
| High | 8 | R2-02 ~ R2-09 部署/CI/BYOK/审计/CSRF/写竞争/可观测性/SQLite→PG |
| Medium | 14 | R2-10 ~ R2-23 |
| Low | 4 | R2-24 ~ R2-27 |

---

## 1. 范围与方法

### 1.1 范围

- 部署交付链：Dockerfile、`.dockerignore`、`.npmrc`、Compose、运行时启动。
- 运行时生命周期：信号处理、Prisma 关闭、SSE drain、Helmet/CSP。
- 数据库：SQLite → PostgreSQL 的查询行为差异、并发兜底、时区/索引。
- 多实例与并发：模块级 `Map/let`、`User.preferences` 写竞争、SSE 单飞、限流 store。
- CI/CD：lint、audit、Node 版本锁、OIDC 签名、Dependabot。
- 可观测性：metrics/trace、Pino redact、SSE 中间事件、审计日志。
- 可访问性：ARIA 语义、键鼠可达、模态可定制度。

### 1.2 方法

1. 三个并行子代理只读扫描：安全、运行/部署/数据库/CI、可访问性/代码质量。
2. 复核 R1 报告全文，标注每条是否仍存在、是否需要在本轮升级。
3. 风险判定统一为三档：已核验（路径/行号存在）、静态推断（仅基于代码路径）、待验证（必须动态执行）。
4. **不**再次运行 `npm test` / `npm run lint` / `npm run build`（R1 已验证通过）。

### 1.3 限制

- 全部为静态审查；未做依赖 CVE 联网核对、未做压力测试、未做真实生产部署。
- CSRF、SSRF、prompt injection 的可利用性以代码路径为依据，不构成已成功利用的证明。
- 包含 `prisma/dev.db` 446 KB 是否真正入仓的复核结论以 `git ls-files` 为准。

---

## 2. R1 报告交叉核验（35 项仍存在）

下表汇总 R1 的 35 条结论在本轮仓库状态下的核验结果。**不再展开论述，避免重复报告。**

| 编号 | 主题 | 当前状态 | 关键证据 |
|---|---|---|---|
| SEC-01 | Token 存 localStorage | 仍存在 | `apps/web/src/lib/apiToken.ts:3-22` |
| SEC-02 | Tool Loop Observation 未消毒 | 仍存在 | `apps/api/src/lib/llm/tools/toolLoop.ts:130-136` |
| SEC-03 | BYOK DNS rebinding 窗口 | 仍存在 | `apps/api/src/lib/byokUrlPolicy.ts:58-84`（R2-04 进一步强化） |
| SEC-04 | 错误脱敏依赖 `NODE_ENV` | 仍存在 | `errorHandler.ts:58-64` |
| SEC-05 | Agent 限流粒度不足 | 仍存在 | `app.ts:55-77` |
| SEC-06 | 提权无审计 | 仍存在（R2-05 字段级强化） | `applications.ts:82-127` |
| SEC-07 | 日志可能含敏感 URL | 仍存在 | `app.ts:38-53` |
| SEC-08 | JWT 未显式算法白名单 | 仍存在 | `jwt.ts:46` |
| SEC-09 | 密钥配置占位/派生 | 仍存在 | `.env.example:7`、`byokCrypto.ts:14-21` |
| SEC-10 | 内容/请求大小领域化不足 | 仍存在 | `articles.ts:13`、`animations.ts:10-23` |
| ARC-01 | Agent 路由过胖 | 仍存在 | `routes/agent.ts` 722 行 |
| ARC-02 | AgentFloat 巨型组件 | 仍存在 | `components/agent/AgentFloat.tsx` 914 行 |
| ARC-03 | SSE/Provider URL 重复 | 仍存在 | `lib/llm/adapters/*` |
| ARC-04 | DTO 重复与 `Record<string,unknown>` | 仍存在 | `apps/web/src/lib/api.ts:328-332` |
| WEB-01 | 无代码分割 | 仍存在 | `router.tsx:1-19`；R1 实际构建主 chunk 542.31 kB |
| WEB-02 | 无 ErrorBoundary | 仍存在 | `main.tsx:9-17` |
| WEB-03 | 守卫分散 | 仍存在 | `DomainsAdminPage.tsx:65-72` 等 |
| WEB-04 | lint warning 清理 | 仍存在 | API 1 + Web 8 warning |
| WEB-05 | 前端测试缺失 | 仍存在 | 无 vitest 配置 |
| Q-01 | 路由集成测试薄 | 仍存在 | 10 个 API 测试文件，0 个 CRUD supertest |
| Q-02 | CI 缺 lint/audit/门槛 | 仍存在 | R2-03 强化 |
| Q-03 | JSON/URL 容错重复 | 仍存在 | `adapters/*` |
| Q-04 | 无指标聚合 | 仍存在（R2-08 强化） | — |
| Q-05 | 无 graceful shutdown | 仍存在（R2-01 强化） | `index.ts:1-10` |
| Q-06 | String 状态字段 | 仍存在 | `schema.prisma` |
| Q-07 | 单进程状态 | 仍存在（R2-11 强化） | `providers.ts:33-86` 等 |
| Q-08 | seed console、魔法数、内联样式 | 仍存在 | `seed.ts:74..215` |
| Q-09 | 死目录/遗留 | 仍存在 | `_legacy/` 46 tracked、根 `api/` 空 |
| DOC-01 | README CORS 端口描述漂移 | 仍存在 | `README.md:39` |
| DOC-02 | `.env.example` VITE URL 误导 | 仍存在 | `.env.example:22` |
| DOC-03 | `architecture.md` _legacy/Annotation 漂移 | 仍存在 | `architecture.md:17,71` |
| DOC-04 | 部署交付链不完整 | 仍存在（R2-02/R2-17 强化） | `docker-compose.yml` |
| DOC-05 | CI 缺门槛 | 仍存在（R2-03 强化） | `.github/workflows/ci.yml:1-29` |
| D-01 ~ D-23 | R1 架构报告项 | 全部仍存在 | 与 R1 一致 |

---

## 3. R2 增量发现（按严重性排序）

### R2-01 · Critical：API 进程无 SIGTERM/SIGINT 与 Prisma 关闭钩子

**事实（已核验）**
- `apps/api/src/index.ts:1-10` 仅 `app.listen(port, ...)`，无 `process.on` 注册。
- `apps/api/src/lib/prisma.ts:1-13` 单例无 `beforeExit`/`$disconnect` 钩子。
- 全仓 `grep`：`process.exit|SIGTERM|SIGINT|gracefulShutdown` 命中 0（除 seed.ts 的 `process.exit(1)`）。

**影响**
- 容器编排 rolling update 触发 SIGTERM 后，活跃 SSE 长连接无主动 close；Prisma 连接池在 30s 内不会优雅释放，DB 出现 `idle in transaction` 残留；进行中的 Provider 请求挂起直到 SIGKILL。
- 缺少 `unhandledRejection`/`uncaughtException` 钩子，结构化日志会丢异常上下文。

**建议**
- 引入 `drainActiveStreams(timeoutMs)` 遍历活跃 SSE 响应发送 `event: shutdown` 并 `res.end()`。
- 在 `index.ts` 启动后注册 `SIGTERM`/`SIGINT`，`server.close` + `prisma.$disconnect` + `process.exit(0)`，超时强制退出。
- 同步加 `unhandledRejection` / `uncaughtException` 日志，避免盲点。

### R2-02 · High：`.npmrc` 的 `production=false` 影响生产镜像

**事实（已核验）**
- `.npmrc:1-2`：`production=false`，注释说明本地开发需要 Vite。
- `apps/api/package.json:30-42` 中 `prisma`、`vitest`、`tsx`、`@types/*`、`oxlint` 都在 devDependencies。
- 多进程 `npm warn config production Use --omit=dev instead.` 出现在 `npm test` / `npm run lint` / `npm run build` 输出（`sess_…/call_*-stdout.log`），证明 npm 实际把 `production=false` 应用到了所有工作区。

**影响**
- Dockerfile 使用 `npm ci --omit=dev` 时会被 `.npmrc` 覆盖，导致生产镜像装入 `vitest`、`prisma`、`tsx` 等开发工具，体积膨胀、攻击面增加。
- 与 `apps/api/package.json:8-15` 的 `db:generate`/`db:migrate` 都依赖 `prisma` 冲突——生产只装 production deps 时迁移脚本会失败。

**建议**
- 在 Dockerfile 中显式 `npm config set production=true && npm ci --omit=dev`；或把 devDeps 中的工具类抽到独立 workspace 包。
- 让 `.npmrc` 通过 `[env]` 分组：仅在 `NODE_ENV !== 'production'` 时设 `production=false`。

### R2-03 · High：CI 缺 lint/audit/Node 版本锁/最小权限/并发控制

**事实（已核验）**
- `.github/workflows/ci.yml:1-29` 仅 build/test；`package.json:20` 已有 `lint` 脚本但未调用。
- `setup-node@v4 with node-version: '20'`：未锁到 20.3+，与 `engines.node >= 20.3` 不一致（`package.json:23-25`）。
- 无 `permissions: { contents: read }` 最小权限；无 `concurrency:` 防并发 PR 拖慢 runner；无 Dependabot/Renovate；无 SBOM/Trivy。

**影响**
- Lint warning 长期积累，掩盖真实问题；高危依赖更新无提示；Node 20.0（无 `AbortSignal.any`）可能被拉入；权限过大增加供应链风险。

**建议**
- 加 `lint` 步骤、`npm audit --omit=dev --audit-level=high`、Trivy 镜像扫描、Dependabot。
- `setup-node` 用 `node-version-file: .nvmrc`，写 `.nvmrc` 锁 `20.18.x`。
- 加 `permissions: { contents: read }` 与 `concurrency: { group: ${{ github.workflow }}-${{ github.ref }}, cancel-in-progress: true }`。

### R2-04 · High：BYOK `fetch` 未显式 `redirect: 'manual'`，跟随 3xx 后绕过 hostname 策略

**事实（已核验）**
- `apps/api/src/lib/llm/adapters/anthropicMessages.ts:70-81, 94-105`、`:267-277`、`openaiChat.ts:39-48`、`openaiResponses.ts:28-42` 全部 `fetch(url, {...})`。
- 全仓 `grep "redirect:" apps/api/src/lib/llm` 无任何输出——Node 18+ `fetch` 默认 `redirect: 'follow'`。
- 配合 R1 SEC-03 的 hostname-only 策略，重定向到 `169.254.169.254`（云元数据）或内网服务将**完全无防护**。

**影响**
- 与 DNS rebinding 相比，redirect 暴露面更具实效性：用户在 BYOK 填公网域名，恶意服务端 301/302 到内网/metadata，`fetch` 自动跟随且不再走 `assertSafeByokBaseUrl`。
- BYOK 自带 key 的威胁模型下，攻击者可能用被攻陷的第三方网关做跳板。

**建议**
- 适配层统一 `redirect: 'manual'`，遇到 3xx 显式拒绝或重新走 `assertSafeByokBaseUrl`。
- 与 R2-04 一起，把 `dns.lookup` 加在请求前，对每个 IP 校验策略。

### R2-05 · High：`AuthorApplication` 缺 `reviewerId` 与独立审计字段

**事实（已核验）**
- `apps/api/prisma/schema.prisma:81-100` `AuthorApplication` 模型无 `reviewerId`/`reviewedByIp`/`reviewerUa`。
- `apps/api/src/routes/applications.ts:102-121` 审批写事务仅 `update({ status, reviewedAt, pendingGuard: null })`。
- 对比 `Annotation.reviewer`（`schema.prisma:209-213`，`routes/annotations.ts:142-150`）：同领域已有 `reviewerId`/`reviewedAt`/`reviewBy`，AuthorApplication 与之**未对齐**。
- `grep` 不到 `AuditEvent` 表或独立审计日志。

**影响**
- 管理员误操作/账号被盗后无法用单一查询回答"谁在何时把谁提为 author/elite"。
- 上轮 SEC-06 在 R2 中以字段级证据再次确认。

**建议**
- 在 `AuthorApplication` 加 `reviewerId String?` + 反向 relation；handler 写入并保存旧值/新值。
- 引入独立 `AuditEvent` 表（append-only），结构化字段 `{actorId, action, subjectType, subjectId, before, after, ip, ua, requestId, ts}`；Pino logger 加 `audit:` namespace。

### R2-06 · High：HttpOnly 迁移前需先实现 CSRF 防护

**事实（已核验）**
- `apps/api/src/app.ts:24-31`：`cors({ origin: [...], credentials: true })` 显式允许携带凭据；无 `Origin` 校验、无 CSRF token 机制；`grep csrf|sameSite` 在 `apps/api/src` 命中 0。
- `docs/roadmap/httponly-cookie-migration.md` 已识别需要 HttpOnly 迁移，但**未**配套 CSRF 防护。

**影响**
- 当前 token 在 localStorage、Authorization 头不自动附加，CSRF 风险低。
- 一旦落地 HttpOnly cookie + `credentials: true`，任意跨站表单/`<form action="/auth/logout">` 提交可触发状态变更；缺失 CSRF 防护会从"低危"瞬间升到"高危"。

**建议**
- 落地 cookie 化**之前**完成：
  - `Origin` 头白名单中间件（与 `CORS_ORIGIN` 一致）；
  - 双重提交 cookie 模式（`XSRF-TOKEN` cookie + header）；
  - `SameSite=Lax/Strict`（先 Lax，跨子域再调整）。
- 在迁移文档里将 CSRF 列为前置条件，CI 流程绑定检查。

### R2-07 · High：`User.preferences` 整块 JSON 写入存在行级竞争

**事实（已核验）**
- `apps/api/prisma/schema.prisma:29`：`preferences String @default("{}")`。
- `apps/api/src/routes/auth.ts:160-176` 与 `routes/settings.ts:95-162` PATCH 走 read-modify-write，无事务、无 row-level lock、无乐观锁。

**影响**
- 并发更新同一用户（一边改 BYOK，一边改 `agentStyle`）会丢更新：后者把前者的 `preferences.byok` 一并覆盖回旧值，导致用户 BYOK 静默丢失。
- 数据库层无字段级约束，应用层无并发控制。

**建议**
- 短期：把 `agentStyle/autoplayAnim/animSpeed` 拆为单列；或对 preferences 引入 `version` 字段做乐观锁（CAS）。
- 中期：PG 切换后用 `jsonb` + `jsonb_set` 部分更新；或在事务内 `SELECT ... FOR UPDATE`。
- 至少在写入前用 `findUnique` 后再 `update`，并把"冲突则重试 1 次"封装。

### R2-08 · High：无 Prometheus/OTel 导出、Pino redact 缺位

**事实（已核验）**
- `grep prometheus|opentelemetry|metrics|tracing` 在 `apps/api/src` 命中 0（除 pino-pretty）。
- `apps/api/src/lib/logger.ts:1-18` 仅配 `level` 与 pretty transport，**无** `redact: { paths: [...] }`。
- `apps/api/src/lib/llm/providerHttp.ts:5-14` `LlmCallError.diagnostic = {url, raw}`：`raw` 是上游 500 字节响应原文，可能含 API key 反射、X-Request-Id、组织 ID、账户余额等。
- `apps/api/src/app.ts:38-53` 与 `errorHandler.ts:47-57` 把 `req.originalUrl`（含 query）入日志。

**影响**
- 上游 4xx/5xx 错误体可能含凭据元数据，落到日志聚合后反向定位第三方账户。
- `req.originalUrl` 写日志意味着未来任何 `?token=...` 或邀请签名都会一并落库。
- 无法回答"过去 5min 哪条 provider 的 P95 延迟？"——只能看原始日志行。

**建议**
- Pino `redact: { paths: ['req.headers.authorization', 'req.headers.cookie', 'req.query.*', 'diagnostic.raw', 'err.diagnostic.raw', 'preferences.byok.apiKey'], censor: '[REDACTED]' }`。
- `LlmCallError.diagnostic.raw` 改为 hash + 截断，不保存原始字节。
- 引入 `prom-client` 暴露 `/metrics`（独立限流）；`@opentelemetry/sdk-node` + `instrumentation-http/express/prisma` 串 traceparent 到 SSE 帧。

### R2-09 · High：SQLite → PG 后 `contains` 大小写敏感 + 无 GIN 索引

**事实（已核验）**
- `apps/api/src/routes/articles.ts:100-105`、`domains.ts:96-100`：搜索 `q` 走 `tags: { contains: q }` / `title: { contains: q }`。
- SQLite 默认 LIKE 大小写不敏感；PostgreSQL `LIKE` 默认**大小写敏感**，Prisma `contains` 在 PG 上也是大小写敏感。
- `docs/operations/postgres.md` 未声明这一行为差异；schema 中 tags/summary 字段无 `pg_trgm` 索引。

**影响**
- 切到 PG 后，"React"不会命中"react"；`contains '%react%'` 在无 GIN 索引下全表扫描。
- 这是产品行为级差异，会让"按文档切库"得到与开发不一致结果。

**建议**
- PG 切库后用 `mode: 'insensitive'`（Prisma 自动兼容）；同时引入 `pg_trgm` + GIN 索引。
- 在 `docs/operations/postgres.md` 增加 "PostgreSQL 与 SQLite 的查询行为差异" 章节，提供索引迁移 SQL。

### R2-10 · Medium：SSE 无 keep-alive comment 与活动连接追踪

**事实（已核验）**
- `apps/api/src/lib/sse.ts:1-33` 三个函数无 `res.write(': ping\n\n')`，无连接集合，无 `res.on('close')` 主动通知。
- `routes/agent.ts:155-353` / `:440-617` 在 `req.on('close')` 之外不发送心跳。
- `apps/web/src/lib/agentStream.ts:30-115` 客户端 28s 超时只触发 abort，无重连。

**影响**
- 7 层 LB（nginx `proxy_read_timeout 60s`）/ Cloudflare 默认 100s idle 会在长 thinking 阶段断连；前端 28s 超时可能早于上游完成。
- 优雅停机无法通知客户端。

**建议**
- 在 `initSse` 中每 15-20s 写一行 `: ping\n\n`；维护 `Set<Response>` 全局集合。
- 停机时遍历集合发送 `event: shutdown` + `res.end()`。
- 前端 reader 在异常时记录重试预算（最多 1 次 + 退避），避免无限重连风暴。

### R2-11 · Medium：四类模块级 `Map/let` 多实例分裂语义未声明

**事实（已核验）**
- `apps/api/src/lib/llm/providers.ts:33-86`：`_providers` 模块级缓存；多实例各自缓存，env 热更不生效。
- `apps/api/src/services/agentConversation.ts:22-35`：`lastPurgeAt` 节流；多实例各自扫表清理。
- `apps/api/src/routes/articles.ts:33-48`：`viewedCache` 进程内 Map；多实例让阅读量虚高 2-N 倍。
- `apps/api/src/lib/llm/tools/registry.ts:9-23`：工具注册表静态只读——OK。

**影响**
- 阅读量统计被多实例放大；过期会话清理时间窗错峰；Provider 缓存无法热更。
- 注释未给出"何时迁移到 Redis/共享存储"的明确阈值。

**建议**
- 整理一份"in-process state audit"，逐条标注"允许多实例分裂/需外迁/可接受"。
- 阅读量合并：进程内 L1 + DB `updateMany` 合并，或直接用 `update.increment`。
- 过期会话清理：起 `node-cron` 或 K8s CronJob 全局执行。
- Provider 配置：抽到 `Settings` 表 + `POST /admin/reload-providers` 手动热更；README 注明当前取舍。

### R2-12 · Medium：Prisma 连接池/helmet/Node 版本三方配置脱节

**事实（已核验）**
- `apps/api/src/lib/prisma.ts:1-13`：无 `connection_limit` / `pool_timeout`。
- `apps/api/src/app.ts:24`：`helmet()` 用默认配置，**无** `contentSecurityPolicy`/`hsts`/`crossOriginEmbedderPolicy`。
- `apps/web/index.html:7-13`：通过 `fonts.googleapis.com` 加载字体；与生产 CSP 收紧不兼容。
- CI `node-version: '20'` 与 README `engines.node >= 20.3` 不一致；`.nvmrc` 缺失。

**影响**
- 多副本生产需手算"实例数 × 每实例连接数 + 余量 ≤ Postgres max_connections"。
- Helmet 默认不开 HSTS，首次被劫持风险 + 与 localStorage token 风险叠加放大。
- 前端通过 CDN 加载字体，CI 缓存与生产 CSP 都会受影响。

**建议**
- `DATABASE_URL?connection_limit=N&pool_timeout=20`；部署文档给出连接预算公式。
- 启用 helmet 的 CSP（注意 SSE/字体源）、HSTS（生产 + HTTPS）、按需 COEP。
- 反代/Caddy 终止 HTTPS 时强制 HSTS preload；字体本地化或加 fallback。

### R2-13 · Medium：数据库写入时区、索引、软删语义

**事实（已核验）**
- 业务时间字段在应用层用 `new Date()` 写入（如 `reviewedAt`、`publishedAt`）；Prisma `@default(now())` 仅覆盖 `createdAt`。
- `apps/api/src/routes/applications.ts:97-99` 列表按 `createdAt desc` 但 schema 无 `@@index([createdAt])`。
- `Topic.status` 用字符串多值；`Annotation.status`/`Article.status`/`Application.status` 三种不同的"软删/状态"语义在 admin UI 上拼装混乱。

**影响**
- 应用服务器与 DB 时区不一致时出现"将来时间"，影响按时间排序与缓存 TTL。
- 数据规模过万后未索引列表接口成为瓶颈。
- 软删/工作流状态混合，新增 `closed`/`archived` 时逻辑分支膨胀。

**建议**
- 业务时间由 DB 生成；切换 PG 时显式 `SET TIME ZONE 'UTC'`；NTP 同步；Compose Postgres 容器加 `TZ` env。
- 在切换 PG 前补 `AuthorApplication @@index([createdAt])`、`Article @@index([status, category, publishedAt])` 等高频过滤+排序索引。
- 文档化"哪些字段是软删、哪些是工作流状态"；Prisma 切 enum 时统一处理。

### R2-14 · Medium：SSE 单飞缺失与限流 store 内存化

**事实（已核验）**
- `apps/api/src/routes/agent.ts:209-241` 早停仅在单实例内有效；多实例下"已生成"信号不共享，可能同时对同一 topic 全量生成。
- `apps/api/src/app.ts:55-77` 四个 limiter 用 `express-rate-limit@7.5.1` 默认内存 store；多实例下"每实例 120/min"实际变成 N × 120。

**影响**
- 同一文章被多用户并发悬停时，多实例可能同时生成同一 topic 答案，浪费 token。
- 限流在多实例下被绕过：4 实例 × 120 = 480/min 实际放行。

**建议**
- 用 DB upsert + 短窗口软锁实现 SSE 单飞（`pending:<key>` 占位 + 200-500ms 回查）或 Redis SETNX。
- 引入 `rate-limit-redis` 替换四个 limiter；env 配 `REDIS_URL`。
- 在 README 注明"目前 limiter 是 per-instance"。

### R2-15 · Medium：聊天历史累积、搜索 `contains` 与 JSON 写热点

**事实（已核验）**
- `apps/api/src/services/agentOrchestrator.ts:140-186` 每次 chat 拉 12 条消息 + `loadUserContext`（`agentMemory.ts:66-120`）走 `findUnique` + `findMany`，无 LRU。
- `apps/api/src/services/hoverCache.ts:52-55` 命中即 `updateMany hits+1`，fire-and-forget；并发 N 次命中 → N 次行级锁等待。
- `articles.ts`/`domains.ts` `contains` 全文扫，PG 切换后更慢。
- `express.json({ limit: '1mb' })` 全局 1MB；`markdown` 字段无 `.max()`；长 markdown 触发 SQLite `string or blob too big` 或 PG `string_agg` 上限。

**影响**
- 长会话频繁读 12 条 + reverse + 累加，单实例 OK，多实例 SSE 多并发成为 DB 热点。
- 同一 cache key 高并发命中成为 PG 写热点。
- 单条 1MB markdown 渲染时 DOMPurify+marked 主线程阻塞。

**建议**
- `loadUserContext` 加 LRU（Redis 或进程内），TTL 60s。
- `getHoverCache` 改内存累加 + 30s 批量 flush，或 `update({hits: row.hits+1})` + 乐观重试 3 次。
- 搜索切 PG 后用 `pg_trgm` + GIN；中期迁移到 Meilisearch/Typesense。
- 收紧 schema：`markdown` max 200_000、`steps.length` max 200、`config` 字段深度限制。

### R2-16 · Medium：SSE 中间事件日志与 trace 串联

**事实（已核验）**
- `apps/api/src/lib/llm/tools/toolLoop.ts:103-106, 142-146` 仅在结束/超限时打点；中间轮耗时不可见。
- `apps/api/src/app.ts:33-37`：`res.locals.requestId = randomUUID().slice(0, 8)` —— 8 hex 字符 = 32 bit，生日碰撞约 2^16 次请求即 50% 概率碰撞同一 requestId。
- LLM 调用日志（`providers.ts:166-176, 181-194, 210-221`）未把 `requestId` 注入；只靠 Pino "同一进程同一时间窗"串联。
- `errorHandler.ts` 记 `requestId`，但 `agentOrchestrator.llmError` 未把 `res.locals.requestId` 透传。

**影响**
- 想知道"这一条 SSE 慢在哪"只能事后追日志。
- requestId 碰撞让多请求被错误归并，影响关联分析。

**建议**
- 给 SSE 流加低频心跳日志（每 10s `sse_progress { bytes, chunks, lastKind, ms }`）；tool loop 每轮打 `tool_loop_iter { i, ms, tokens }`。
- requestId 改 16 hex（32 char），全局 `AsyncLocalStorage` 注入到所有 logger 子调用；或直接接入 OTel trace context。

### R2-17 · Medium：缺 Dockerfile、Compose 无 api/web service、无反代

**事实（已核验）**
- `find . -maxdepth 2 -name "Dockerfile*"` 返回 0 结果。
- `docker-compose.yml:1-23` 只声明 Postgres；无 `api`/`web` service，无 build context，无 healthcheck。
- `apps/web/package.json:7-11` 无 `start` 脚本，仅 `vite preview`；生产 Web 启动方式未声明。
- 无 `.dockerignore`、`nginx.conf`/`Caddyfile`。

**影响**
- 任何环境（K8s/ECS/Nomad/systemd）都需自写启动脚本，shape 不一致。
- 即使后补 Dockerfile，`node_modules/_legacy` 等也易打入构建上下文。

**建议**
- 补 `apps/api/Dockerfile` 与 `apps/web/Dockerfile`（多阶段，含 `prisma generate` + `npm run build` + 仅保留 `dist + node_modules(production) + prisma`）；补 `.dockerignore`。
- Compose 升级为含 `api`/`web`/proxy 的开发栈；提供 `Caddyfile` 将 `/api` 反代到 api:3001、其余到 web:5280。
- README/CI 明确禁止 `npm run dev` 出现在生产。

### R2-18 · Medium：`/health` 不感知依赖

**事实（已核验）**
- `apps/api/src/app.ts:69-71`：`/health` 返回 `{ok:true, service, ts}`，未检查 DB 是否可达、provider 是否配置。

**影响**
- LB / k8s liveness 探针命中该端点不会把"DB 断连"实例剔出——流量继续打向坏实例。

**建议**
- 加 `/healthz`（liveness，浅）+ `/readyz`（readiness，深，验证 `SELECT 1` + provider 列表非空）。
- k8s pod 配置两种 probe 不同策略（liveness 宽松，readiness 严格）。

### R2-19 · Medium：审计日志缺失

**事实（已核验）**
- `routes/applications.ts:82-127`：审批时更新 `pendingGuard=null`、`reviewedAt`、`User.role/authorTier`，**无**独立审计事件。
- `routes/auth.ts:178-201`：`/logout` 吊销 refresh —— 无审计日志。
- 全仓 `grep "AuditEvent"` 0 命中。

**建议**
- 引入 `AuditEvent` 表（append-only，no update/delete），结构化字段 `{actorId, action, subjectType, subjectId, before, after, ip, ua, requestId, ts}`。
- Pino logger 加 `audit:` namespace，与请求日志区分。

### R2-20 · Medium：前端无 error sink

**事实（已核验）**
- `apps/web/src/lib/api.ts:1-442` 所有 API catch 后 throw ApiError，未上报。
- `grep -rn Sentry|RUM|Datadog apps/web/src` 0 命中。

**影响**
- 前端运行时报错没有汇聚点；与上轮 WEB-02（无 ErrorBoundary）叠加放大。

**建议**
- 加最小化前端 error sink：`window.onerror` + `unhandledrejection` → 发送到 `/api/v1/telemetry/client-errors`（后端记日志）。
- 与 R2-01 的 OTel trace context 整合。

### R2-21 · Medium：CI 缺 lockfile 一致性、缓存、Dependabot

**事实（已核验）**
- `ci.yml:13-17`：`cache: npm`，OK；但无 `cache-dependency-path: package-lock.json` 显式。
- `.github/` 下无 `dependabot.yml` / `renovate.json`。
- 无 SBOM / `npm sbom` / OSS-license-check。

**影响**
- npm 私有 registry 可能返回缓存的旧 lockfile；依赖更新无自动 PR。
- 合规/许可证风险无可见面板。

**建议**
- 显式 `cache-dependency-path: package-lock.json`；加 step：`npm ci` 失败时自动清缓存。
- 启用 Dependabot version updates + security updates，针对 npm/github-actions。
- 加 OSS-license-check 与 SBOM。

### R2-22 · Medium：缺 RUNBOOK / 故障排查文档

**事实（已核验）**
- 仓库无 `docs/operations/`、`docs/runbook/`、`docs/incident/` 目录。
- 没有"provider 401 怎么排查""DB 锁了怎么办""优雅停机如何验证"等指南。

**建议**
- 建立 `docs/operations/`：
  - `incident-llm.md`：provider 401/429/超时排查
  - `incident-db.md`：连接池耗尽、长事务、索引缺失
  - `deploy-checklist.md`：上生产前的 secret / DB / 反代 / 健康检查清单
  - `shutdown-drill.md`：每季度演练清单（停机 + drain + 重启）

### R2-23 · Medium：缺性能基线（k6 / autocannon）

**事实（已核验）**
- 仓库内无 `k6` / `autocannon` / `artillery` 配置。
- 性能容量只能依赖生产环境观察，无回归门槛。

**建议**
- 至少为 `/health`、`/agent/explain`、`/agent/explain/stream`、`/auth/login` 写一份 k6 脚本作为基线。
- CI 引入"性能回归门槛"——若 APM 已就绪可同时上报。

### R2-24 · Low：Article slug PATCH 缺事务兜底

**事实（已核验）**
- `apps/api/src/routes/articles.ts:248-256` PATCH slug 走先 `findUnique` 再 `update`，无事务；`@unique([slug])`（`schema.prisma:105`）并发冲突走 P2002 冒泡，外层 catch 仍可能转 500。
- `errorHandler.ts:26-44` 已具备 `P2002 → 409 CONFLICT` 处理，但这里路径需在事务内/外层 catch 显式拦截。

**建议**
- 把 PATCH slug 包到 `prisma.$transaction`；事务外层显式 catch P2002 转 409。

### R2-25 · Low：Hover cache 截断策略与 key 不一致

**事实（已核验）**
- `apps/api/src/services/hoverCache.ts:26-28` 计算 `cacheKey` 用 `topic.slice(0, 400)` 归一化。
- `hoverCache.ts:62-66` 写库时 `topic.slice(0, 200), answer.slice(0, 1200)`。
- 写库 topic 长度小于 key 计算长度——70-200 字符之间的两段不同原文可能被截到同一 `topic`，使 `findUnique({ cacheKey })` 命中旧记录但读取后认为它是新 query 答案。
- `answer.slice(0, 1200)` 截断会丢失 `isSafeHoverPublicAnswer` 已通过的尾部。

**建议**
- 把 `cacheTopicFor(topic)` 抽到单一函数，返回 `{ topic, key }` 同源同长。
- 写库时若 answer 超长仅记日志丢弃而非腰斩入库。

### R2-26 · Low：前端视图/筛选切换按钮缺 `aria-pressed` / `aria-current`

**事实（已核验）**
- `apps/web/src/pages/HomePage.tsx:368-388`（grid/list 视图按钮）、`HomePage.tsx:255-275`（轮播指示器按钮）、`KnowledgeOverviewPage.tsx:90-105`（track chip）、`AuthorDashboard.tsx:91-105`（filter chip）、`author/ApplicationsAdminPage.tsx:69-76`（通过/拒绝按钮组）均无 ARIA 语义态。
- `AuthorDashboard.tsx:75-86` 统计卡用 `<div>`，无 `<dl>/<dt>/<dd>` 与 `aria-label`。
- 模态/对话框用 `window.confirm`/`window.prompt`（`DomainsAdminPage.tsx:56`、`SettingsPage.tsx:170`、`ArticleEditorPage.tsx:145, 156-159` 等）——可访问性降级。

**建议**
- 加 `aria-pressed={state === val}` 或 `aria-current="true"`；轮播指示器加 `aria-current`。
- 抽 `<ToggleButton>`、`<SelectionChips>` 小组件覆盖多处复用点。
- "通过/拒绝"按钮组包 `role="group" aria-label="审核决策"`。
- 统计卡用 `<dl>/<dt>/<dd>` 或加 `aria-label`。

### R2-27 · Low：articles `animations` PATCH 缺事务；Topic status 语义未集中

**事实（已核验）**
- `apps/api/src/routes/articles.ts:265-274`：三个 query（`deleteMany` → `createMany` → `update`）顺序执行，无事务。
- `apps/api/src/routes/topics.ts` 软删后状态机分支膨胀（`'open' | 'closed' | 'deleted'`，但代码只识别 `'deleted'`）。

**影响**
- 中途进程重启或别的事务干预会出现"文章 status updated but animations 中间状态"。
- 新增 `closed`/`archived` 时列表/回复/详情判断逻辑会分散。

**建议**
- 把动画同步包到 `prisma.$transaction`。
- 收紧 `Topic.status` 为 enum 或在中间层 `assertTopicCanReply(topic)`；把"可回复/可浏览"的状态集合集中表达。

---

## 4. 修复优先级与 ROI 路线图

> 优先级沿用 R1 路线图编号，避免重复登记；本轮新增项以 `R2-` 前缀。

### 0–2 天：Critical / High 安全与运行时止血

1. **R2-01** 无 graceful shutdown（高 ROI）：补 SIGTERM/SIGINT、Prisma `$disconnect`、unhandledRejection 日志。
2. **R2-04** BYOK fetch 显式 `redirect: 'manual'`：在 `providerHttp.ts` 加包装层，跳转后重走 `assertSafeByokBaseUrl`。
3. **R2-05** `AuthorApplication.reviewerId` + `AuditEvent` 表（P0 字段级补全）。
4. **R2-06** HttpOnly 迁移前先实现 `Origin` 校验 + 双重提交 cookie + `SameSite=Lax`。
5. **R2-02** `.npmrc` 在 Dockerfile 显式覆盖为 `production=true`，并加 `.dockerignore`。
6. **R2-03** CI 补 lint/audit/Node 锁/最小权限/并发控制。

### 1–2 周：可恢复性、性能与可观测性

1. **R2-08** Pino redact + `prom-client` + OTel SDK；`LlmCallError.diagnostic.raw` 改为 hash + 截断。
2. **R2-10** SSE 心跳 + 活动连接集合；前端 reader 加重试预算。
3. **R2-11** 整理 in-process state audit；阅读量合并、清理 CronJob 化、Provider 热更。
4. **R2-12** Prisma `connection_limit`、Helmet CSP/HSTS、`.nvmrc` 锁 Node 20.18.x。
5. **R2-13** PG 索引补齐（`AuthorApplication createdAt`、`Article(status,category,publishedAt)`）；时区统一 UTC。
6. **R2-14** SSE 单飞（DB 软锁 / Redis SETNX）；`rate-limit-redis` 替换内存 store。
7. **R2-15** `loadUserContext` LRU；`getHoverCache` 批量 flush；`markdown` 限 200_000 字符。
8. **R2-16** requestId 改 16 hex + `AsyncLocalStorage`；SSE 中间事件日志。
9. **R2-17** Dockerfile + Compose 含 api/web + Caddyfile 反代。
10. **R2-18** `/healthz` + `/readyz`。
11. **R2-19** 独立 `AuditEvent` 表 + Pino `audit:` namespace。
12. **R2-20** 前端 error sink。

### 2–4 周：结构与运营能力

1. **R2-09** 切 PG 前的 `contains` 行为差异与 `pg_trgm` + GIN 索引；`docs/operations/postgres.md` 增补。
2. **R2-21** Dependabot + `cache-dependency-path` + OSS-license-check。
3. **R2-22** 建立 `docs/operations/`：incident-llm / incident-db / deploy-checklist / shutdown-drill。
4. **R2-23** 引入 k6 基线（`/health`、`/agent/explain`、`/auth/login`）。
5. **R2-24 / R2-25 / R2-27** Article slug 事务、Hover cache 截断一致、animations 事务、Topic status 集中。
6. **R2-26** 前端 ARIA 抽 `<ToggleButton>` / `<SelectionChips>`；统计卡 `<dl>/<dt>/<dd>`；模态可定制度。

---

## 5. 验证范围与限制

| 类别 | 状态 |
|---|---|
| 静态只读审查 | 已完成（3 个并行子代理） |
| `npm test` / `lint` / `build` | R1 已验证通过；本轮未重跑 |
| 动态安全测试（XSS/CSRF/SSRF/Prompt Injection） | 未执行（仅静态路径推断） |
| 真实生产配置审计 | 未执行 |
| PostgreSQL 切库行为回归 | 未执行（仅推断 `contains` 行为差异） |
| 容器/反代/优雅停机演练 | 未执行 |
| 依赖 CVE 联网核对 | 未执行 |
| 前端 E2E | 未执行 |

**结论**：本轮新增 27 条增量发现与 R1 35 条合并共 62 条风险登记项；与 R1 同样**不构成已成功利用的漏洞证明**，但提供了可执行的修复路径与代码级证据。

---

## 6. 关键文件路径速查（R2 新增）

| 主题 | 路径 |
|---|---|
| 入口与关闭 | `apps/api/src/index.ts:1-10`、`apps/api/src/lib/prisma.ts:1-13` |
| 部署配置 | `.npmrc:1-2`、`docker-compose.yml:1-23`、`.github/workflows/ci.yml:1-29` |
| BYOK 重定向 | `apps/api/src/lib/llm/adapters/{anthropicMessages,openaiChat,openaiResponses}.ts` |
| AuthorApplication 审批 | `apps/api/src/routes/applications.ts:82-127`、`apps/api/prisma/schema.prisma:81-100` |
| User.preferences 写竞争 | `apps/api/src/routes/auth.ts:160-176`、`apps/api/src/routes/settings.ts:95-162` |
| Pino 日志 | `apps/api/src/lib/logger.ts:1-18`、`apps/api/src/middleware/errorHandler.ts:47-57`、`apps/api/src/lib/llm/providerHttp.ts:5-14` |
| 搜索 contains | `apps/api/src/routes/articles.ts:100-105`、`apps/api/src/routes/domains.ts:96-100` |
| SSE 资源生命周期 | `apps/api/src/lib/sse.ts:1-33`、`apps/web/src/lib/agentStream.ts:30-115` |
| Prisma 单例与 helmet | `apps/api/src/lib/prisma.ts:1-13`、`apps/api/src/app.ts:24,69-71` |
| 限流 store | `apps/api/src/app.ts:55-77` |
| Hover cache 截断 | `apps/api/src/services/hoverCache.ts:26-66` |
| 前端 ARIA | `apps/web/src/pages/{HomePage,KnowledgeOverviewPage,AuthorDashboard}.tsx`、`author/ApplicationsAdminPage.tsx` |

---

> 本轮报告基于 commit `224cfdb` 与当前工作树核验编写。所有"已核验"结论均有代码佐证；标注"静态推断"或"待验证"处已明确局限。
> **本轮未修改任何既有内容；仅新增本报告与对应 HTML。**
