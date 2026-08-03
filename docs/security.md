# 安全清单

逐项对照代码（`apps/api/src/` 与 `apps/web/src/`）的实际实现。

## 已实现

- [x] 密码 bcrypt — `apps/api/src/lib/hash.ts`，cost 12
- [x] JWT — `apps/api/src/lib/jwt.ts`：密钥来自 `JWT_SECRET`；长度校验（≥16 字符）；`Authorization: Bearer` 校验；access + refresh 双 token
- [x] 写接口 RBAC — `apps/api/src/middleware/auth.ts`：`requireAuth` / `requireRole(...)` / `requirePermission(...)` / `requireAdminLevel(min)`；权限矩阵在 `packages/shared/src/permissions.ts`
- [x] HTTP — `apps/api/src/app.ts`：
  - `helmet()` 默认中间件
  - CORS 白名单（`CORS_ORIGIN`，默认 `http://localhost:5173`）
  - `TRUST_PROXY`：仅当 `TRUST_PROXY=1` 时信任第一跳代理（默认关闭，防伪造 XFF 绕过限流）
  - JSON 体积上限 1 MB
- [x] `/agent/cache/clear` 限管理员（`requireRole('admin')`）
- [x] rate limit — `express-rate-limit`：
  - 全局 `generalLimiter`：120 req/min
  - 鉴权 `authLimiter`：20 req/min
  - Agent `agentLimiter`：40 req/min
- [x] 请求体验证 — `apps/api/src/middleware/validate.ts`（Zod schema），错误统一映射 `VALIDATION_ERROR`
- [x] Markdown 渲染消毒 — `apps/web/src/lib/markdown.ts` 使用 `DOMPurify.sanitize`（含 `ALLOWED_TAGS`、`ALLOWED_ATTR` 白名单）
- [x] 统一错误体 — `apps/api/src/middleware/errorHandler.ts`：
  - `AppError` → `{ error: { code, message } }`
  - Zod → `VALIDATION_ERROR`
  - Prisma `P2002/P2003/P2025` → `CONFLICT` / 等
  - 其它 500 不暴露堆栈
- [x] Agent 路由限流更严（见上 `agentLimiter`）
- [x] BYOK 仅服务端 — `apps/api/src/lib/llm/providers.ts`：`byokToProvider` 不写日志；前端 `lib/apiToken.ts` 仅在请求头携带；`maskApiKey` 用于脱敏展示
- [x] MCP 协议入口占位 — `GET /api/v1/mcp/status` 返回 `status: 'reserved'`（**MCP 进程未实现**）
- [x] `SEED_ADMIN_PASSWORD` 必填（缺失即 seed 退出）；已有用户不自动提权，需 `SEED_FORCE_ADMIN=1`

## 未实现 / 待办

- [ ] 生产替换 `JWT_SECRET` 与足够强度的 `SEED_ADMIN_PASSWORD`
- [ ] 生产使用 PostgreSQL（当前 SQLite 占位；`schema.prisma` 已可切换 `provider`）与 HTTPS 终止
- [ ] 备份与密钥轮转流程
- [ ] 批注（`Annotation`）写入/审核 API（模型已有，路由缺失）
- [ ] 评论 CRUD（产品决定不做交互后端；路由暂无）
- [ ] 工具循环（tool-loop）的安全护栏：参数 Zod 校验、超时、次数上限、审计日志（**待工具循环上线**）
- [ ] 记忆写入策略与提示词注入防御深化（当前仅启发式「请记住」匹配）

## BYOK

- 用户 BYOK 仅服务端解析为 Provider 配置；不写日志；前端只展示 `baseUrlHost` + `maskApiKey`
- 切换 Provider 时，旧的 `AgentMemory`/`LearningProgress` 仍属用户，不受影响
- 服务端默认 Provider（StepFun / OpenAI / Generic）通过 `STEPFUN_*` / `OPENAI_*` / `GENERIC_LLM_*` 环境变量配置

## 路由与限流一览

| 路径前缀 | 限流 | 鉴权 |
|---------|------|------|
| `/health` | 无 | 无 |
| `/api/v1/auth/*` | 20/min | 公开（注册/登录） |
| `/api/v1/articles` | 全局 120/min | 公开读 / 写需 `author` 或 `admin` |
| `/api/v1/animations` | 全局 120/min | 写需 `author` 或 `admin` |
| `/api/v1/author-applications` | 全局 120/min | reader 提交 / admin 审批 |
| `/api/v1/domains` | 全局 120/min | 写需 `domain.manage`（admin ≥50） |
| `/api/v1/settings` | 全局 120/min | 登录用户 |
| `/api/v1/topics` | 全局 120/min | 登录用户发帖/回复 |
| `/api/v1/agent/*` | 40/min | 公开 + 可选登录（hover/chat 可匿名；memory/progress/cache/clear 需登录） |
| `/api/v1/mcp/status` | 全局 120/min | 无 |