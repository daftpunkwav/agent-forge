---
type: 前端功能
title: 页面清单（读者、账户、作者、管理）
description: 每个路由页面的职责、数据源 API、权限门槛与关键交互，按域组织的完整页面目录。
tags: [frontend, pages, ui]
---

# 页面清单

按域组织的路由页面目录（路由表见 [前端总览](./overview.md)）。每页注明：API 数据源、权限门、关键交互。

## 读者端

| 路由 | 页面 | 数据源 | 要点 |
|------|------|--------|------|
| `/` | HomePage | `listArticles`（latest + popular 双 feed） | Hero（HomeHeroAnim 有机粒子动画）+ 领域轮播（`DomainCarousel`，5.2s 自动、`DOMAIN_VISIBLE=4`）+ FeedColumn（popular 用 `exclude=latestIds` 去重）；视图模式存 `agentforge-view-mode` |
| `/knowledge` | KnowledgeOverviewPage | `listDomains(track)` | 领域地图：track 过滤 chips（agent/llm/all）+ 视图切换（存 `agentforge-domain-view`）+ `#domain-{slug}` 锚点跳转；每域渲染 DomainSection |
| `/llm` | LlmOverviewPage | `listDomains('llm')` | LLM 基础总览（同 Knowledge 骨架，track 固定 llm） |
| `/knowledge/:slug`、`/llm/:slug` | ArticlePage | `getArticle(slug)` | ArticleLayout（TOC 侧栏 + 头部 + 正文 + 批注区）；「Agent 详细讲解」发 `agentforge:explain` 事件开面板；登录用户「标记已掌握」→ `agentProgress({mastery:'mastered'})`；`SLUG_TEMPLATE` 按 slug 给默认动画模板；内联 `ArticleAnnotations`（列表 + 提交表单，无审核 UI） |
| `/domains/:slug` | DomainDetailPage | `getDomain(slug, {page,q,level,sort})` | URL 参数全驱动（page≥1、level 入门/中级/高级、sort newest/popular/title）；文章卡片按 `domain.track==='llm'` 路由到 `/llm/{slug}`；每页 8 篇 |
| `/search` | SearchPage | `listDomains` + `listArticles({q,level,domain})` | 跨域检索；domain/level 选择即时改写 URL（page→1）；结果按 `category==='LLM基础'`/domain slug 含 llm 路由 |
| `/news` | NewsPage | 无（**纯静态**） | 3 条硬编码演示资讯（2025-06/05/04），标注「静态精选 · 演示数据」；未来接资讯 API |
| `/topics` | TopicsPage（列表） | `listTopics({pageSize:40})` | 浏览为主，发布入口独立；kind/作者/回复数/160 字摘要/关联文章 |
| `/topics/new` | TopicNewPage | `createTopic` | `useAuth().can('topic.post')` 门；kind 选择 + `?article=` 预填关联文章 |
| `/topics/:id` | TopicDetailPage | `getTopic` + `replyTopic` | 全文 + 回复（pre-wrap）；回复后重拉详情；文章链接 |

## 账户端

| 路由 | 页面 | 数据源 | 要点 |
|------|------|--------|------|
| `/login` `/register` | AuthPages | `useAuth().login/register` | 登录区分 ApiError vs 网络错误（「无法连接服务器…」）；注册客户端校验密码 ≥8；成功跳 `/profile` |
| `/profile` | ProfilePage | `updateProfile` → PATCH `/auth/me` | 资料表单保存后 `setTokens` + `refresh()`（claims 立即生效）；角色感知入口：申请作者/优秀作者、工作台、领域管理（`can('domain.manage')`）、审批（isAdmin）、设置 |
| `/settings` | SettingsPage | `getSettings`/`updateSettings`/`testLlm` | 主题强调色、动画 autoplay/speed（localStorage 同步）、agentStyle 5 选、**BYOK 表单**（掩码显示、留空不改 key、加载成功前禁保存）、测试模型（先保存再打 test-llm）、**清除 Agent 缓存**（先 L1 `clearAllHoverCaches` 再 L2 `api.clearAgentCache`，admin） |

## 作者端

| 路由 | 页面 | 数据源 | 要点 |
|------|------|--------|------|
| `/author` | AuthorDashboard | `listArticles({mine:true})` + `listAnimations(true)` | `isAuthor` 门；统计卡（发布数/草稿/总阅读/动画数）；文章筛选 chips；动画库 + 模板卡（`ANIMATION_TEMPLATES` → 新建带 `?template=`） |
| `/author/articles/new`、`/author/articles/:id/edit` | ArticleEditorPage | listAnimations + listArticles（admin 用 status=all）→ getArticle 拉详情；create/update/publish | Markdown 纯 textarea 编辑：`insertAtCursor`（选区感知）、`wrapHoverTerm` → `[[术语|提示]]`、`insertHoverImage` → `![alt](url){agent="hint"}`、`insertHoverSnippet`、`insertAnimation` 追加 `:::animation{id}:::` 围栏；预览 tab 渲染 ArticleBody（`data-agent-zone="knowledge"`）；保存 vs 发布；tags 恒 `[]`、readMinutes 钳 1–120 |
| `/author/animations/new`、`/:id/edit` | AnimationEditorPage | getAnimation/create/update | 模板选择（`ANIMATION_TEMPLATES`）切换重置默认步（`resolveDefaultSteps`）；步骤 CRUD（label/type/desc；type 决定高亮相位——ReAct 用 thought/action/observation/answer）；实时预览 AnimationViewer；保存后展示嵌入围栏 |
| `/author/apply`（`?kind=elite`） | ApplyAuthorPage | `applyAuthor` | 身份门槛（已作者/已 elite/admin 拦截）；field 选择 + bio ≥10 字；成功 1.5s 后跳 profile |
| `/author/applications` | ApplicationsAdminPage | `listApplications` + `reviewApplication` | `isAdmin` 门；pending 行「通过/拒绝」；审批后重拉 |

## 管理端

| 路由 | 页面 | 数据源 | 要点 |
|------|------|--------|------|
| `/admin/domains` | DomainsAdminPage | `listDomains(undefined, all=true)` + create/delete | `isAdmin` 门；创建表单**先客户端校验 slug 正则 `^[a-z0-9-]+$`**（注释：后端校验会拒中文自动 slug，先提示手动修改）；删除 confirm（文章不删，仅解除关联）；行内 hidden 标记 + 预览链接 |

## 通用组件

- `components/article/ArticleBody`：markdown + `:::animation{id}:::` 嵌入渲染、跨块 heading id 注入（`data-article-body data-agent-zone="knowledge"`）。
- `components/article/ArticleLayout` + `TableOfContents`：TOC 侧栏（IntersectionObserver 高亮、平滑滚动）、页脚「就本文发帖 →」。
- `components/article/ArticleCardInlineAgent`：**首页/列表卡片行内 Agent**（悬停展开、全局展开锁 cardExpandLock、摘要截断按 layout feed/grid/list 分档）。
- `components/ui/*`：Button（primary/secondary/ghost × sm/md/lg）、Input/TextArea/Select/Field、Tag（primary/secondary/muted/outline）。
- `components/domain/DomainSection`：领域文章块（grid 8/list 6 分页 + 8s 自动轮换、hover 暂停、内联 Agent 卡片）。
- `components/home/HomeHeroAnim`：Hero 装饰动画（blob + 星座 + 鼠标跟随聚光，`prefers-reduced-motion` 禁用）。

## 相关页面

- 数据层：[前端总览](./overview.md)（api.ts 客户端）
- 悬停/面板交互：[Agent UI](./agent-ui.md)
