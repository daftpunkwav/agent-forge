---
type: 安全设计
title: 安全基线与防护机制
description: AgentForge 的认证令牌体系、RBAC 权限矩阵、限流、BYOK 加密与 SSRF 防护、Markdown 消毒、统一错误契约等安全设计与当前待办。
tags: [security, auth, rbac, byok, rate-limit]
---

# 安全基线与防护机制

安全设计分布在 `apps/api/src/app.ts`（HTTP 层）、`middleware/auth.ts`（鉴权）、`lib/byokCrypto.ts` / `byokUrlPolicy.ts`（BYOK）、`lib/errors.ts` / `errorHandler.ts`（错误契约）、`apps/web/src/lib/markdown.ts`（消毒）。以下每项均有源码与聚焦测试背书。

## 认证：JWT access + refresh

- **access**：默认 15m（`JWT_ACCESS_EXPIRES_IN`，兼容旧 `JWT_EXPIRES_IN`），payload 含 `sub / email / role / authorTier / adminLevel`；`JWT_SECRET` 必须 ≥16 字符，否则启动即抛错（`lib/jwt.ts`）。
- **refresh**：默认 7d（`JWT_REFRESH_EXPIRES_IN`）；明文 `randomBytes(32).base64url` 仅下发一次，DB 存 sha256（`RefreshToken.tokenHash`）。刷新时**原子吊销旧条**（`updateMany where tokenHash, revokedAt: null, expiresAt > now`）——并发刷新只有一方成功，防重放。
- 前端当前把两枚 token 存 localStorage（`lib/apiToken.ts`）；`api.ts` 在 401 时**单飞** refresh 一次后重试（跳过 auth 端点自身）。HttpOnly Cookie 迁移为待办（`docs/httponly-cookie-migration.md`）。
- 聚焦测试：`lib/jwt.test.ts`（时长解析、refresh 高熵/不可逆、access 过期优先级）。

## 授权：shared 权限矩阵 + 中间件

- 身份模型：guest（运行时） / reader / author（含 authorTier） / admin（adminLevel 1–100）。矩阵在 `packages/shared/src/permissions.ts`（`can(principal, permission)`）。
- 中间件（`middleware/auth.ts`）：`optionalAuth`（坏 token 忽略）、`requireAuth`、`requireRole(...roles)`、`requirePermission(...perms)`（调 shared `can`）、`requireAdminLevel(min)`。
- 分级规则：`domain.manage` / `user.manage` 需 adminLevel ≥50；`admin.full` 需 100；`moderation.review` 仅 admin 或 **elite 作者**（业务层再限定作者只能审自己文章，见 `services/annotationAcl.ts`）。
- 前端同源使用同一 `can()`（`useAuth`），页面/组件据此渲染权限门。

## 限流（express-rate-limit，见 `app.ts`）

| 范围 | 窗口 | 上限 |
|------|------|------|
| 全站 generalLimiter | 1 min | 120 |
| `/api/v1/auth/*` authLimiter | 1 min | 20 |
| `/api/v1/agent/*` agentLimiter | 1 min | 40 |
| `POST /api/v1/settings/test-llm` | 1 min | 40（防绕过 agentLimiter） |

- `standardHeaders: true`、`legacyHeaders: false`；限流拒绝体为 `{ error: { code: 'RATE_LIMIT', message } }`。
- `trust proxy` 默认关闭，仅 `TRUST_PROXY=1` 时信任第一跳，防止伪造 X-Forwarded-For 绕过限流。

## HTTP 层与错误契约

- `helmet()`、CORS 白名单（`CORS_ORIGIN` 逗号分隔 + `credentials: true`）、JSON 体积上限 1MB。
- `requestId`（8 位 hex UUID）贯穿请求日志与错误日志。
- 统一错误体 `{ error: { code, message } }`（`middleware/errorHandler.ts`）：`AppError` 原样；Zod → `VALIDATION_ERROR`(400)；Prisma P2002 → `CONFLICT`(409)、P2003 → `BAD_REQUEST`(400)、P2025 → `NOT_FOUND`(404)；其余 500 `INTERNAL_ERROR`（生产隐藏堆栈）。

## BYOK 安全（A-03 + SSRF）

- **静态加密**（`lib/byokCrypto.ts`）：AES-256-GCM（**12 字节随机 IV**），密文格式 `enc:v1:{iv}.{tag}.{data}`（iv/tag/data 各 base64）；密钥取 `BYOK_ENCRYPTION_KEY`（≥16）或回退 `JWT_SECRET` 派生（sha256(`byok-encryption-v1:{raw}`)）。历史明文读取兼容，下次写入自动升级。**密钥轮换后旧密文无法解密**（读取返回空、BYOK 静默回退服务端默认）——轮换前需让用户重填 key。
- **防二次加密**（`resolveByokApiKeyToStore`）：提交值**精确等于掩码哨兵 `••••` 时视为「未修改」**（防御性兜底，前端实际传空串）；未提交新 key 时先解密旧密文再入库；解密失败**保留原密文**，绝不落空销毁；仅 `clearByokKey: true` 显式清空。
- **SSRF 防护**（`lib/byokUrlPolicy.ts`）：仅约束用户可控的 BYOK baseUrl。拒绝非 http/https、含 userinfo 的 URL、本机/私网/链路本地/云 metadata 地址（IPv4 块：0/8、10/8、127/8、169.254/16、172.16–31/12、192.168/16、100.64/10 CGNAT、≥224；IPv6：::1、::、fe80、fc/fd、::ffff 映射回 IPv4 检查）、`.localhost/.local/.internal` 后缀与常见 metadata 主机名。违规抛 `BYOK_URL_REJECTED`(400)，settings 写入与 `byokToProvider`（运行时解析）共用同一校验。
- 聚焦测试：`byokCrypto.test.ts`（roundtrip、legacy 明文、损坏密文 → ''、密钥轮换、防二次加密回归）、`byokUrlPolicy.test.ts`（IPv4/IPv6/hostname 黑名单、凭证拒绝、尾斜杠规范化）。

## Markdown 消毒与 LLM 输出安全

- 前端 `lib/markdown.ts`：marked(GFM) → DOMPurify 白名单（`ADD_ATTR` 含 id/target/rel/class/`data-agent-*`），`afterSanitizeAttributes` hook 收紧 `A` 标签的 `target`/`rel`（仅 `_blank` + `noopener noreferrer`）。
- **LLM 输出净化**：悬停答案必须过 `@agentforge/shared` 的 `hoverSanitize`（规则复述/策划/自我改稿检测），服务端 L2 缓存与前端 L1 缓存写入前都做质检；deep/chat 的 thinking 流经 `isSystemEcho` per-delta 门控，final 用安全累积片段（A-04 / I3）。详见 [提示词与净化](../agent/prompt-sanitize.md)。
- **LLM 错误脱敏**（A-01）：上游 url/原文只进 `LlmCallError.diagnostic`（日志），客户端/SSE 只见 `messageForClient` 安全文案（`agent.sse.test.ts` 断言不泄漏私有网关与 trace）。

## 其他防护

- 密码 bcrypt cost 12（`lib/hash.ts`）；`SEED_ADMIN_PASSWORD` 无内置兜底。
- 动画单条读取按作者/管理员过滤；话题删除仅 owner/admin；批注写/审 ACL（见 [社区域](../backend/community.md)）。
- tool-loop 护栏：白名单工具 + Zod 参数校验 + 每工具 8s 超时 + 默认 ≤5 轮 + pino 审计（见 [ReAct tool-loop](../agent/tool-loop.md)）。
- 匿名会话 guestKey ACL：仅凭 conversationId 不可续写（防 IDOR，`agentConversation.test.ts` 覆盖）。

## 未实现 / 待办（来源：docs/security.md、docs/dev-progress.md）

- HttpOnly Cookie 迁移（refresh 存 localStorage 的 XSS 窃取窗口）。
- 生产强 `JWT_SECRET` / `SEED_ADMIN_PASSWORD`、PostgreSQL + HTTPS 终止、备份与密钥轮转流程。
- 评论 CRUD、Agent 自动审注接线、tool-loop 深化（observation 注入防御、独立限流、更多工具）。
