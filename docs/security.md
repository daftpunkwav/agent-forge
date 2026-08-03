# 安全清单

> 最后核对：2026-08-03（对照 `apps/api/src/` 与 `apps/web/src/`）

## 已实现

- [x] 密码 bcrypt — `apps/api/src/lib/hash.ts`，cost 12
- [x] JWT access token — `apps/api/src/lib/jwt.ts`：`JWT_SECRET`（≥16 字符）；`Authorization: Bearer`；过期由 `JWT_EXPIRES_IN`（默认 7d）控制。**无 refresh token / 无 `/auth/refresh`**
- [x] 写接口 RBAC — `middleware/auth.ts`：`requireAuth` / `requireRole` / `requirePermission` / `requireAdminLevel`；矩阵在 `packages/shared/src/permissions.ts`
- [x] HTTP — `app.ts`：
  - `helmet()` 默认中间件
  - CORS 白名单（`CORS_ORIGIN`；代码硬编码默认 `http://localhost:5173`，本地应设为 `http://localhost:5280`，见 `.env.example`）
  - `TRUST_PROXY`：仅当 `TRUST_PROXY=1` 时信任第一跳代理（默认关闭）
  - JSON 体积上限 1 MB
- [x] `/agent/cache/clear` — `requireAuth` + `requireRole('admin')`
- [x] rate limit — `express-rate-limit`：
  - 全局 `generalLimiter`：120 req/min
  - 鉴权 `authLimiter`：20 req/min
  - Agent `agentLimiter`：40 req/min
- [x] 请求体验证 — Zod（`middleware/validate.ts`）→ `VALIDATION_ERROR`
- [x] Markdown 消毒 — 前端 `lib/markdown.ts` + DOMPurify 白名单
- [x] 统一错误体 — `errorHandler.ts`（`AppError` / Zod / Prisma P2002·P2003·P2025；500 不暴露堆栈）
- [x] 结构化日志 — Pino（`lib/logger.ts`）；生产 JSON，开发 pretty
- [x] BYOK 仅服务端 — `providers.ts` 不写密钥日志；前端脱敏展示（`maskApiKey`）
- [x] BYOK apiKey 静态加密（A-03）— AES-256-GCM 密文入库（`lib/byokCrypto.ts`）；密钥取 `BYOK_ENCRYPTION_KEY`（≥16 字符）或回退 `JWT_SECRET` 派生；历史明文读取兼容，写入时自动升级
- [x] LLM 错误信息脱敏（A-01）— 上游 `url`/原始报文只进日志（`LlmCallError.diagnostic`），客户端仅见安全文案；SSE 错误事件同样脱敏
- [x] 同步 LLM 调用超时（A-02）— 默认 30s `AbortSignal.timeout`；hover 兜底重试 12s
- [x] MCP 探测占位 — `GET /api/v1/mcp/status` → `status: 'reserved'`（进程未实现）
- [x] `SEED_ADMIN_PASSWORD` 必填（≥8 字符，无内置兜底）；已有用户不自动提权，需 `SEED_FORCE_ADMIN=1`

## 未实现 / 待办

- [ ] 生产替换强 `JWT_SECRET` 与强 `SEED_ADMIN_PASSWORD`
- [ ] 生产 PostgreSQL + HTTPS 终止（当前默认 SQLite）
- [ ] refresh / 短时 access 轮换（当前仅长时 access，存前端 localStorage）
- [ ] 备份与密钥轮转流程
- [ ] 批注（`Annotation`）写入/审核 API
- [ ] 评论 CRUD（产品侧未做交互后端）
- [ ] tool-loop 安全护栏（参数校验、超时、次数上限、审计）— 待工具循环上线
- [ ] 记忆写入策略与提示词注入防御深化

## BYOK

- 用户 BYOK 仅服务端解析为 Provider；不写日志；前端只展示 host + 脱敏 key
- apiKey 静态加密（AES-256-GCM，`lib/byokCrypto.ts`）：库中不留明文；`BYOK_ENCRYPTION_KEY` 未配置时回退 `JWT_SECRET` 派生密钥
- 服务端默认 Provider：StepFun / OpenAI / Generic（`STEPFUN_*` / `OPENAI_*` / `GENERIC_LLM_*`）

## 路由与限流一览

| 路径前缀 | 限流 | 鉴权 |
|---------|------|------|
| `/health` | 无 | 无 |
| `/api/v1/auth/*` | 20/min | 注册/登录公开；`/me` 等需登录 |
| `/api/v1/articles` | 120/min | 公开读 / 写需 author 或 admin |
| `/api/v1/animations` | 120/min | 写需 author 或 admin |
| `/api/v1/author-applications` | 120/min | reader 提交 / admin 审批 |
| `/api/v1/domains` | 120/min | 写需 `domain.manage`（admin ≥50） |
| `/api/v1/settings` | 120/min | 登录用户 |
| `/api/v1/topics` | 120/min | 登录用户发帖/回复 |
| `/api/v1/agent/*` | 40/min | hover/chat 可匿名；memory/progress 需登录；cache/clear 需 admin |
| `/api/v1/mcp/status` | 120/min | 无 |
