# 身份、权限与交流模型

> 最后核对：2026-08-03

## 四种身份

| 身份 | 入库 | 说明 |
|------|------|------|
| 游客 guest | 否 | 浏览公开知识、看已通过话题；不可发帖/批注/创作；可匿名使用悬停/面板 Agent（会话 7 天 TTL） |
| 读者 reader | 是 | 默认注册；可话题；可申请作者；批注能力为产品设计（路由未上线） |
| 作者 author | 是 | 工作台、发文、动画；`authorTier=elite` 为优秀作者 |
| 管理员 admin | 是 | `adminLevel` 1–100；100 为超级管理员（种子账号） |

> 枚举见 `packages/shared/src/permissions.ts`：`UserRole = 'reader' \| 'author' \| 'admin'`；`authorTier = 'none' \| 'standard' \| 'elite'`；`adminLevel` 默认 0。权限覆盖 `content.* / annotation.* / topic.* / author.* / domain.manage / user.manage / moderation.review / admin.full`。

认证：`Authorization: Bearer <accessToken>`；登录/注册/`PATCH /me` 另下发 `refreshToken`（SPA localStorage）。`POST /auth/refresh` 旋转；`POST /auth/logout` 吊销。

## 作者层级

- `authorTier=standard`：普通作者  
- `authorTier=elite`：优秀作者（先成作者再申请）  
- `allowAgentAnnotationReview`：是否允许 Agent 代审批注（字段已有，审核 API 未上线）

## 管理员分级

| Level | 能力 |
|-------|------|
| ≥1 | 基础管理、审核申请 |
| ≥50 | 领域管理、用户管理（`domain.manage` / `user.manage`） |
| ≥100 | `admin.full`；种子超级管理员 |

中间件：`requireAdminLevel(min)`。

## 批注流

> API：`/api/v1/annotations`（`routes/annotations.ts`）。游客仅见 `approved`；登录用户见 approved + 自己的；文章作者或 admin 见该文全部。

1. 读者提交 → `pending`（需 `annotation.write`）  
2. 若作者开启 Agent 审核 → Agent 通过/拒绝（`allowAgentAnnotationReview` 尚未接线）  
3. 否则文章作者或管理员人工审核 → `approved` / `rejected`（`PATCH /annotations/:id`）  
4. 游客仅可见 `approved`

## 话题

- 登录用户可发帖/回复，可附带文章（`Topic.articleId` 可空）
- API：`/api/v1/topics`（`routes/topics.ts`）
- 软删除字段 `status` 存在；前端当前以 `open` 为主

## Agent 上下文

- 面板：`AgentConversation` + `AgentMessage`；>24 条时压缩最旧 8 条到 `summary`
- 偏好：启发式写入 `AgentMemory`
- 悬停：L2 `HoverExplainCache`（键版本 `v7`，TTL 2h / 热 24h）+ 前端 L1；净化在 `@agentforge/shared`
- 进度：`POST /api/v1/agent/progress` → `LearningProgress`；`mastered` 时追加记忆
