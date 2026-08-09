# 安全清单

> 最后核对：2026-08-04（对照 `apps/api/src/` 与 `apps/web/src/`）

## 已实现

- [x] 密码 bcrypt — `apps/api/src/lib/hash.ts`，cost 12
- [x] JWT access + refresh 轮换 — `apps/api/src/lib/jwt.ts`：
  - access：`JWT_ACCESS_EXPIRES_IN`（默认 `15m`；兼容旧 `JWT_EXPIRES_IN`）
  - refresh：`JWT_REFRESH_EXPIRES_IN`（默认 `7d`）；明文下发一次，DB 存 sha256（`RefreshToken`）；`POST /auth/refresh` 旋转吊销旧令牌；`POST /auth/logout` 吊销
  - 前端仍用 localStorage（`apiToken.ts`）；`api.ts` 遇 401 单次 refresh 后重试
  - 兼容：仅持有旧长时/短时 access、无 refresh 的客户端在 access 过期前仍可用
- [x] 写接口 RBAC — `middleware/auth.ts`：`requireAuth` / `requireRole` / `requirePermission` / `requireAdminLevel`；矩阵在 `packages/shared/src/permissions.ts`
- [x] HTTP — `app.ts`：
  - `helmet()` 默认中间件
  - CORS 白名单（`CORS_ORIGIN`；默认 `http://localhost:5280`，与 Vite 一致）
  - `TRUST_PROXY`：仅当 `TRUST_PROXY=1` 时信任第一跳代理（默认关闭）
  - JSON 体积上限 1 MB
- [x] `/agent/cache/clear` — `requireAuth` + `requireRole('admin')`
- [x] rate limit — `express-rate-limit`：
  - 全局 `generalLimiter`：120 req/min
  - 鉴权 `authLimiter`：20 req/min
  - Agent `agentLimiter`：40 req/min
  - `/settings/test-llm`：40 req/min（与 Agent 同级，防绕过）
- [x] 请求体验证 — Zod（`middleware/validate.ts`）→ `VALIDATION_ERROR`
- [x] Markdown 消毒 — 前端 `lib/markdown.ts` + DOMPurify 白名单
- [x] 统一错误体 — `errorHandler.ts`（`AppError` / Zod / Prisma P2002·P2003·P2025；500 不暴露堆栈）
- [x] 结构化日志 — Pino（`lib/logger.ts`）；生产 JSON，开发 pretty
- [x] BYOK 仅服务端 — `providers.ts` 不写密钥日志；前端脱敏展示（`maskApiKey`）
- [x] BYOK apiKey 静态加密（A-03）— AES-256-GCM 密文入库（`lib/byokCrypto.ts`）；密钥取 `BYOK_ENCRYPTION_KEY`（≥16 字符）或回退 `JWT_SECRET` 派生；历史明文读取兼容，写入时自动升级
- [x] BYOK baseUrl SSRF 策略（`lib/byokUrlPolicy.ts`）— 禁本机/私网/metadata；settings 写入与 `byokToProvider` 共用
- [x] 匿名会话 guestKey ACL — 仅凭 `conversationId` 不可续写
- [x] 动画 `GET /animations/:id` 所有权检查（作者本人或 admin）
- [x] LLM 错误信息脱敏（A-01）— 上游 `url`/原始报文只进日志（`LlmCallError.diagnostic`），客户端仅见安全文案；SSE 错误事件同样脱敏
- [x] 同步/流式 LLM 调用超时（A-02）— 默认 30s `AbortSignal.timeout`；hover 兜底重试 12s
- [x] MCP 探测占位 — `GET /api/v1/mcp/status` → `status: 'reserved'`（进程未实现）
- [x] `SEED_ADMIN_PASSWORD` 必填（≥8 字符，无内置兜底）；已有用户不自动提权，需 `SEED_FORCE_ADMIN=1`
- [x] tool-loop 安全护栏（P0）— 白名单工具名、Zod 参数校验、每工具 `AbortSignal.timeout(8s)`、`TOOL_LOOP_MAX_ITERS`（默认 5）、pino 审计（name/ok/ms，无密钥）；见 `apps/api/src/lib/llm/tools/`

## 未实现 / 待办

- [ ] 生产替换强 `JWT_SECRET` 与强 `SEED_ADMIN_PASSWORD`
- [ ] 生产 PostgreSQL + HTTPS 终止（默认仍 SQLite；已提供 `docker-compose.yml` + `docs/postgres.md` 切换步骤）
- [ ] HttpOnly cookie 迁移（当前 refresh/access 仍存 SPA localStorage，XSS 可窃取）— **方案见 `docs/httponly-cookie-migration.md`**
- [ ] 备份与密钥轮转流程
- [x] 批注（`Annotation`）写入/审核 API — `GET/POST /api/v1/annotations`、`PATCH /api/v1/annotations/:id`（ACL：游客只读 approved、登录者写 pending、文章作者/admin 审；`reviewBy` 仅 `author|admin`，Agent 自动审尚未接线）
- [ ] 评论 CRUD（产品侧未做交互后端）
- [ ] tool-loop 深化（更多工具、MCP、observation 注入防御 / 速率细分）— **路线见 `docs/tool-loop-roadmap.md`**
- [ ] 记忆写入策略与提示词注入防御深化

## BYOK

- 用户 BYOK 仅服务端解析为 Provider；不写日志；前端只展示 host + 脱敏 key
- apiKey 静态加密（AES-256-GCM，`lib/byokCrypto.ts`）：库中不留明文；`BYOK_ENCRYPTION_KEY` 未配置时回退 `JWT_SECRET` 派生密钥
  - ⚠️ **密钥轮换警告**：轮换 `BYOK_ENCRYPTION_KEY` 或回退密钥 `JWT_SECRET` 后，历史密文将无法解密（读取返回空、BYOK 静默回退服务端默认，用户无感知错误）。轮换前需让用户重新填写 BYOK key，或先清空 `User.preferences` 中的 `byok`
- 服务端默认 Provider：StepFun / OpenAI / Generic（`STEPFUN_*` / `OPENAI_*` / `GENERIC_LLM_*`）

## 路由与限流一览

| 路径前缀 | 限流 | 鉴权 |
|---------|------|------|
| `/health` | 无 | 无 |
| `/api/v1/auth/*` | 20/min | 注册/登录/refresh 公开；`/me` 需登录；`/logout` 可选鉴权（可凭 refresh 吊销） |
| `/api/v1/articles` | 120/min | 公开读 / 写需 author 或 admin |
| `/api/v1/animations` | 120/min | 写需 author 或 admin |
| `/api/v1/author-applications` | 120/min | reader 提交 / admin 审批 |
| `/api/v1/domains` | 120/min | 写需 `domain.manage`（admin ≥50） |
| `/api/v1/settings` | 120/min | 登录用户 |
| `/api/v1/topics` | 120/min | 登录用户发帖/回复 |
| `/api/v1/annotations` | 120/min | 公开读（ACL）；写需登录 + `annotation.write`；审需作者或 admin |
| `/api/v1/agent/*` | 40/min | hover/chat 可匿名；memory/progress 需登录；cache/clear 需 admin |
| `/api/v1/mcp/status` | 120/min | 无 |
