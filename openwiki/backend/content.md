---
type: 后端业务域
title: 内容域：文章、动画与领域
description: /api/v1/articles、/animations、/domains 的路由行为、权限门槛与不变量，以及 services/serialize.ts 的 API 响应契约。
tags: [backend, content, articles, animations, domains]
---

# 内容域：文章、动画与领域

路由文件：`routes/articles.ts`、`routes/animations.ts`、`routes/domains.ts`；DTO 映射在 `services/serialize.ts`。

## API 响应契约（services/serialize.ts）

所有内容 API 的响应形状由该服务产出（前端 `@agentforge/shared` DTO 只是类型契约，此处是运行时映射）：

| 函数 | 产出 | 要点 |
|------|------|------|
| `toPublicUser` | PublicUser | ISO 日期、role/authorTier 断言 |
| `toArticleSummary` / `toArticleDetail` | ArticleSummary / ArticleDetail | `tags` 为 JSON 字符串入库，经 `parseJsonArray` 还原为数组；publishedAt ISO；detail 追加 markdown + animations（含 animation 完整定义） |
| `toAnimationDef` | AnimationDef | `steps`/`config` 为 JSON 字符串，`JSON.parse` 还原（失败回退 `[]`/`{}`） |
| `toTopicSummary` | TopicSummary | `bodyMax` 选项控制列表摘要截断（160 字） |
| `toAnnotationItem` | AnnotationItem | reviewBy/reviewedAt/agentNote 可空 |
| `slugify` | string | 小写、空白→`-`、去非 `[\w\u4e00-\u9fff-]`、去首尾连字符、截 80 字；**空串兜底为随机短串** `article-${ts36}${randomBytes(3).hex}`（注释明确「非时间戳」，同一毫秒两次保存也唯一） |

> 字段约定：`Article.tags`、`AnimationDef.steps/config` 一律 `JSON.stringify` 入库、序列化时解析——**改动这两类字段必须在序列化层同步**。

## 文章（/api/v1/articles）

### GET /
查询参数：`status`（published 默认；`all` 仅 admin；`draft` 仅本人）、`category`、`domainId`、`domain`（slug，先查 id）、`level`、`q`（title/summary/tags 包含）、`mine=1`（本人全部，不分页）、`page/pageSize`（≤48，默认 24）、`sort`（latest | popular）、`exclude`（逗号分隔 id，首页双 feed 去重用）。

### GET /:slug
- 详情：author/domain/animations（按 sortOrder 升序）。
- **草稿门**：非 published 仅作者本人或 admin 可见（否则 404，不泄露存在性）。
- **阅读量去重**：published 时异步 `viewCount+1`，24h 内同 `userId|ip` 只计一次（进程内存 Map，>10k 键顺带清理过期键；多实例各计各的，生产可换 Redis）。

### POST /
`requireAuth + requireRole('author','admin')`；`slug` 缺省用 `slugify(title)`，与现有冲突时追加 `-${Date.now().toString(36)}`；创建时 `animationIds` 嵌套 create `ArticleAnimation`（sortOrder = 下标）；初始 status=draft。

### PATCH /:id
owner 或 admin；`slug` 改动先 `slugify` 归一化，与其他文章冲突 → 409；`status=published` 且原非 published → 补 `publishedAt`；**`animationIds` 传入时 deleteMany + createMany 重建关联**（不传则不动）。

### POST /:id/publish
owner 或 admin；标题与正文均非空才可发布；`publishedAt` 保留首次发布时间。

## 动画（/api/v1/animations）

- `stepSchema`：`{ id?, label, desc?, type?, payload? }`；创建至少 1 步。
- **GET /**：按所有权过滤——mine=1 或登录用户 → 本人；admin → 全部；游客 → `authorId='__none__'`（空结果）。
- **GET /:id**：仅作者本人或 admin 可读单条（`forbidden` 否则）。
- **POST / + PATCH /:id**：requireRole author/admin；owner 或 admin 才可改。`steps`/`config` JSON 字符串入库。

## 领域（/api/v1/domains）

- **GET /**：`track`（agent|llm）过滤；`all=1` 仅 admin（含未发布）；读者只见 published；`_count.articles` 只统计 published。
- **GET /:slug**：详情 + 文章分页（pageSize ≤24 默认 8）；`sort` newest | popular | title；未发布领域仅 admin 可见（404）。
- **POST / + PATCH /:id + DELETE /:id**：`requirePermission('domain.manage')`（adminLevel ≥50）；slug 正则 `^[a-z0-9-]+$`（前端 DomainsAdminPage 先校验，中文自动 slug 会被后端拒）；**DELETE 事务内先解除文章关联（domainId=null）再删除**，文章不删除。

## 聚焦测试与变更面

- 无内容域专属单测文件（行为经 `agent.sse.test.ts` 等集成路径间接覆盖）；主要证据在 `services/serialize.ts` 与路由源码。
- 前端消费点：`lib/api.ts`（listArticles/getArticle/createArticle/updateArticle/publishArticle、listAnimations/getAnimation/createAnimation/updateAnimation、listDomains/getDomain/createDomain/updateDomain/deleteDomain）→ [前端总览](../frontend/overview.md)。
- 种子内容（20 篇 + 5 领域 + 动画关联）见 [数据模型](../architecture/data-model.md)。
