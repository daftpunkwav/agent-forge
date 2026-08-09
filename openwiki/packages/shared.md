---
type: 共享包
title: "@agentforge/shared（DTO、权限矩阵、悬停净化）"
description: 前后端共享的 DTO 类型、权限矩阵 can()、悬停净化 hoverSanitize 单一真相，以及变更共享代码的连锁影响。
tags: [shared, dto, permissions, sanitize]
---

# @agentforge/shared

npm workspace `packages/shared`，被 `apps/api` 与 `apps/web` 同时引用（`"@agentforge/shared": "*"`）。构建：`tsc -p tsconfig.json` → `dist/`（`main/types/exports` 指向 `./dist/index.js|d.ts`；`src/**/*.test.ts` 排除在 tsc 构建外，测试走 Vitest）。**改本包后必须先构建 shared 再构建两端**（CI 也按此顺序）。

## 导出内容（src/index.ts）

- **DTO 类型**：`PublicUser`、`DomainSummary`、`ArticleSummary`、`ArticleDetail`（+markdown/animations）、`AnimationStep`、`AnimationDef`、`TopicSummary`、`AnnotationItem`、`ApiErrorBody`、`AuthTokens`、`AuthorApplicationInput`、`AgentExplainRequest`；标量类型 `ArticleStatus`（draft|published）、`ArticleLevel`（入门/中级/高级）、`ArticleCategory`（6 类）、`AnimationTemplate`（9 个）、`ApplicationStatus/Kind`、`AgentExplainMode`、`AgentStyle`、`LlmApiFormat`。
- **常量**：`ARTICLE_CATEGORIES`、`ANIMATION_TEMPLATES`（id/label/desc）、`ANIMATION_FENCE`（`':::animation'`）。
- **权限**：`can` / `isAuthorLike` / `isAdminLike` / `roleLabel`（见下）。
- **悬停净化**：`hoverSanitize.ts` 全量函数 + 前端别名 `stripSelfRevisionClient` / `isSafeHoverDisplay` / `isLikelyHoverTeachingClient`（详见 [提示词与净化](../agent/prompt-sanitize.md)）。

## 权限矩阵（permissions.ts）

身份：`UserRole = reader|author|admin`；`AuthorTier = none|standard|elite`；运行时 `guest`（不入库）。`Permission` 13 项：content.read/comment、annotation.read/write、topic.read/post、author.apply/elite_apply/workspace、domain.manage、user.manage、moderation.review、admin.full。

`can(principal, perm)` 规则：

- guest：仅 `content.read`、`annotation.read`、`topic.read`。
- reader：基础读 + topic.post + author.apply + annotation.write。
- author：+ `author.workspace`、`author.elite_apply`；`moderation.review` **仅 elite**（业务层再细判是否同文）。
- admin：全量；**分级**——`domain.manage`/`user.manage` 需 `adminLevel ≥ 50`，`admin.full` 需 `adminLevel ≥ 100`。

`isAuthorLike`（author|admin）、`isAdminLike(p, minLevel=1)`、`roleLabel`（游客/读者/作者/优秀作者/管理员/高级管理员/超级管理员）。

**消费方**：后端 `middleware/auth.ts`（requirePermission）、`services/annotationAcl.ts`；前端 `useAuth`（can/isAuthor/isAdmin/isEliteAuthor/roleLabel）、各页面权限门。

## hoverSanitize 单一真相

见 [提示词与净化](../agent/prompt-sanitize.md)：卡片上限（3 句 / 220 字）、六族检测正则、公共函数（extractHoverAnswer/finalizeHoverCardText/isCompleteHoverAnswer/isSafeHoverPublicAnswer/sanitizeHoverDisplay 等）、「只加不减」变更纪律、缓存键版本联动。

## 变更表面

| 变更 | 连锁影响 | 验证 |
|------|----------|------|
| 改 DTO 字段 | api serialize.ts 映射 + web api.ts 类型 + 各页面消费 | `npm run build --workspace=@agentforge/shared` 后两端 build/typecheck |
| 改权限矩阵 | 后端中间件与前端 UI 门同时变 | `packages/shared` smoke.test.ts（can 分级）+ api 路由测试 |
| 改净化正则/上限 | 悬停缓存内容变化 → 升级 L2 键版本 vN；前端 L1 自然失效 | `agentPrompt.hover.test.ts` 命名用例先补回归样例 |

## 聚焦测试

- `smoke.test.ts`：guest 权限冒烟（可 content.read/annotation.read，不可 workspace/domain.manage）；adminLevel 50 可 domain.manage、10 不可；`isSafeHoverPublicAnswer`/`looksLikeHoverPlanning` 冒烟。
- `agentPrompt.hover.test.ts`（在 api workspace，测本包逻辑经 agentPrompt re-export）：12 个净化命名用例。
