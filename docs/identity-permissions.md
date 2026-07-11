# 身份、权限与交流模型

## 四种身份

| 身份 | 入库 | 说明 |
|------|------|------|
| 游客 guest | 否 | 浏览公开知识、看已通过批注/话题；不可发帖/批注/创作 |
| 读者 reader | 是 | 默认注册；可评论/话题/批注（批注待审）；可申请作者 |
| 作者 author | 是 | 工作台、发文、动画；`authorTier=elite` 为优秀作者 |
| 管理员 admin | 是 | `adminLevel` 1–100；100 为超级管理员（种子账号） |

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

## 批注流

1. 读者提交 → `pending`
2. 若作者开启 Agent 审核 → Agent 通过/拒绝
3. 否则作者或管理员人工审核 → `approved` / `rejected`
4. 游客仅可见 `approved`

## 话题

- 登录用户可发帖/回复，可附带文章
- 软删除 `status=deleted`

## Agent 上下文

- 面板对话：`AgentConversation` + `AgentMessage` 服务端持久化
- 重要偏好：写入 `AgentMemory`
- 悬停讲解：`HoverExplainCache` 7 天复用 + 前端本地缓存
