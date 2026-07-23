# 身份、权限与交流模型

## 四种身份

| 身份 | 入库 | 说明 |
|------|------|------|
| 游客 guest | 否 | 浏览公开知识、看已通过批注/话题；不可发帖/批注/创作 |
| 读者 reader | 是 | 默认注册；可评论/话题/批注（批注待审）；可申请作者 |
| 作者 author | 是 | 工作台、发文、动画；`authorTier=elite` 为优秀作者 |
| 管理员 admin | 是 | `adminLevel` 1–100；100 为超级管理员（种子账号） |

> 实际角色枚举见 `packages/shared/src/permissions.ts`：`UserRole = 'reader' | 'author' | 'admin'`；`authorTier = 'none' | 'standard' | 'elite'`；`adminLevel` 默认 0（非管理员）。权限矩阵（`Permission`）覆盖 `content.* / annotation.* / topic.* / author.* / domain.manage / user.manage / moderation.review / admin.full`。

## 作者层级

- `authorTier=standard`：普通作者
- `authorTier=elite`：优秀作者（读者先成作者再申请）
- 作者可设置 `allowAgentAnnotationReview`：是否允许 Agent 代审批注

## 管理员分级

| Level | 能力 |
|-------|------|
| ≥1 | 基础管理、审核申请/批注 |
| ≥50 | 领域管理、用户管理 |
| ≥100 | 全站最高权限 |

实际接口侧：`requireAdminLevel(min)` 中间件校验；`User.adminLevel` 默认 0（非管理员）；种子超级管理员 `adminLevel=100`。

## 批注流

> 当前状态：**模型 `Annotation` 已建立（`apps/api/prisma/schema.prisma`），但 `apps/api/src/routes/` 中暂无 annotations 路由**，前端也未提供批注 UI。下文为产品设计，待工具循环与审核流上线后启用。

1. 读者提交 → `pending`
2. 若作者开启 Agent 审核 → Agent 通过/拒绝
3. 否则作者或管理员人工审核 → `approved` / `rejected`
4. 游客仅可见 `approved`

## 话题

- 登录用户可发帖/回复，可附带文章（`Topic.articleId` 可空）
- 模型 `Topic` + `TopicReply`，API：`/api/v1/topics`（`topics.ts`）
- 软删除字段 `status`（模型存在，前端当前仅 `open` 状态流转）

## Agent 上下文

- 面板对话：`AgentConversation` + `AgentMessage` 服务端持久化；超过 24 条时滚动压缩最旧 8 条到 `summary`
- 重要偏好：写入 `AgentMemory`（启发式匹配「请记住/我的偏好/以后…用」）
- 悬停讲解：`HoverExplainCache`（默认 TTL 2h，热 key 24h；`isCompleteHoverAnswer` 质检）+ 前端 `lib/hoverExplainCache.ts` L1
- 学习进度：`POST /api/v1/agent/progress` 写入 `LearningProgress`；`mastered` 时同时追加 `mastered:<slug>` 记忆
