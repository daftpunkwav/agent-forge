# AgentForge — 产品与实施计划（修订版）

> 状态：已确认技术路径与关键决策；已实现核心读者/作者/管理/双 Agent 主路径；未实现：工具循环、推理模式切换、MCP 进程、独立 Agent Runtime、批注 API
> 最后更新：2026-07-23

阶段实现情况详见 `docs/dev-progress.md`。

---

## 1. 产品目标

**AgentForge（Agent 锻造坊）**：可上线的 Agent/LLM 学习平台。

| 能力 | 说明 |
|------|------|
| 读者端 | 学习路径、富文本文章、可分步/暂停动画、Grid/List 首页、注册登录、申请成为作者、评论占位 |
| 作者端 | 工作台、Markdown 写作、动画模板编辑器、发布/草稿、统计 |
| 系统种子内容 | 全部核心知识点长文 + 配套动画（非「每节几句话」） |
| 预留 | 评论 CRUD、站内 Agent 对话/悬停讲解/BYOK/学习记忆（仅接口与 UI 占位） |

**设计原则：** 组件化、模块单一职责、可扩展 monorepo、安全默认、适合公开发布。

---

## 2. 已确认决策

| 决策点 | 选择 |
|--------|------|
| 技术栈 | **Vite + React + TypeScript** 前端；**Express + Prisma** 后端 |
| 包管理 | **npm workspaces**（无 pnpm） |
| 动画作者工具 | **模板 + 步骤参数编辑**（非自由画布） |
| 内容策略 | **系统种子长文 + 作者可续写/发布** |
| Agent 对话 | **本次不实现**，契约 + UI 占位 |
| 评论 | **预留 UI/表结构**，不实现交互后端 |

---

## 3. 目标架构

### 3.1 Monorepo

```
AgentForge/
├── package.json                 # workspaces + 统一 scripts
├── .env.example
├── docker-compose.yml           # 可选：Postgres（生产）
├── apps/
│   ├── web/                     # 读者 + 作者前端（同一 SPA，路由/角色分流）
│   │   ├── src/
│   │   │   ├── app/             # router, providers
│   │   │   ├── components/      # ui / layout / article / anim / author / agent
│   │   │   ├── pages/           # 路由页面
│   │   │   ├── features/        # auth, articles, animations, author-apply
│   │   │   ├── hooks/
│   │   │   ├── lib/             # api client, markdown, security helpers
│   │   │   ├── styles/          # tokens.css, global
│   │   │   └── types/
│   │   └── vite.config.ts
│   └── api/                     # REST API
│       ├── src/
│       │   ├── routes/          # auth, users, articles, animations, applications, agent(stub)
│       │   ├── middleware/      # auth, rbac, rateLimit, validate, errorHandler
│       │   ├── services/        # 业务逻辑
│       │   └── lib/             # prisma, jwt, hash, sanitize
│       └── prisma/schema.prisma
├── packages/
│   └── shared/                  # 共享 DTO、枚举、zod schema
├── content/
│   └── seed/                    # 种子文章 Markdown + 动画 JSON（导入 DB 或构建时内嵌）
├── services/                    # 未来独立服务（仅 README + 契约）
│   ├── agent/
│   └── mcp/
└── docs/
    ├── architecture.md
    ├── security.md
    └── content-guide.md         # 文章/动画编写规范
```

### 3.2 角色模型

```
guest  →  可读公开文章、可注册
reader →  登录、个人主页、申请作者、评论占位
author →  工作台、MD 编辑、动画模板编辑、发布文章
admin  →  审批作者申请（首版可用你本人账号 + role=admin）
```

- 读者申请作者：提交 `AuthorApplication`，admin 审批后 `User.role = author`
- 你作为站主：种子账号 `role=admin|author`，直接使用作者端

### 3.3 路由地图

**读者端**

```
/                              首页（Grid / List 切换）
/knowledge                     知识总览
/knowledge/:slug               文章详情（TOC + 动画 + 评论占位）
/llm/:slug                     LLM 基础文章
/news                          前沿资讯
/login  /register
/settings  /profile
/author/apply                  申请成为作者
```

**作者端**（需 `author` 或 `admin`）

```
/author                        工作台（统计、文章列表、动画库入口）
/author/articles/new           新建文章
/author/articles/:id/edit      Markdown 编辑 + 预览 + 插入动画
/author/animations             动画列表
/author/animations/new         选模板 → 步骤参数编辑
/author/animations/:id/edit
/author/applications           （admin）作者申请审批
```

**API**

```
POST   /api/v1/auth/register|login|logout|refresh
GET    /api/v1/me
GET    /api/v1/articles?status=published
GET    /api/v1/articles/:slug
POST   /api/v1/articles              # author
PATCH  /api/v1/articles/:id
POST   /api/v1/articles/:id/publish
GET|POST|PATCH  /api/v1/animations   # author
POST   /api/v1/author-applications   # reader
GET|PATCH /api/v1/author-applications  # admin
POST   /api/v1/agent/*               # 501 预留
POST   /api/v1/comments              # 501 或仅占位
GET    /health
```

### 3.4 数据模型（Prisma 要点）

```prisma
User            id, email, passwordHash, name, role(guest|reader|author|admin), createdAt
AuthorApplication userId, field, bio, status(pending|approved|rejected), reviewedAt
Article         id, slug, title, summary, markdown, category, level, status(draft|published),
                authorId, readMinutes, tags[], publishedAt, viewCount
AnimationDef    id, name, template(react|cot|tot|got|loop|mcp|tool|memory|custom),
                steps Json, config Json, authorId, createdAt
ArticleAnimation articleId, animationId, positionHint  # 文章内嵌入点
Comment         预留字段，无写接口或 501
AgentMemory     预留表，无业务
LearningProgress 可选：userId, articleId, progress
```

文章正文中嵌入动画：Markdown 自定义语法，例如：

```markdown
:::animation{id="anim_xxx"}
:::
```

渲染时替换为 `AnimationPlayer` + 对应模板组件。

---

## 4. 功能规格

### 4.1 读者端

- **首页**：知识域卡片；**GRID / LIST 视图切换**（持久化 localStorage）
- **文章页**：左侧 TOC（h2/h3）、正文、嵌入动画（play/pause/step/reset/speed）、延伸阅读、评论占位
- **登录注册 / 设置 / 个人主页**（学习进度可 mock 或读 LearningProgress）
- **Agent 浮动按钮**：面板文案「即将推出」，输入禁用；`data-agent-explain` 挂载点仅 toast

### 4.2 作者端

| 模块 | 规格 |
|------|------|
| 工作台 | 已发布/草稿/阅读量/动画数；文章筛选；入口到编辑器与动画库 |
| Markdown 编辑器 | 分屏编辑 + 实时预览；工具栏（标题、列表、代码、引用、插入动画）；XSS 消毒后渲染 |
| 动画工具 | 选模板 → 编辑每步 label/desc/type/payload → 实时预览播放器 → 保存 AnimationDef → 在文章中插入 |
| 发布流 | 草稿保存、发布、下架（可选）、slug 唯一 |
| 申请流 | 读者提交；admin 审批 |

**动画模板（首版）：** `react | cot | tot | got | loop | mcp | tool | memory`  
每模板固定布局组件 + `steps[]` 参数驱动，作者改文案与步骤顺序，不改底层图形引擎。

### 4.3 种子内容（必须丰富）

每篇至少包含：**导语、概念、动画、原理分节（每节多段说明）、对比/表格、代码示例、最佳实践、常见误区、延伸阅读**。  
避免「标题下仅 1–2 句」。目标篇幅：约 **1500–4000 中文字** / 核心篇（LLM 入门可略短）。

**必覆盖 slug 列表：**

| 分类 | slug |
|------|------|
| 推理 | react, cot, tot, got |
| 协议/工程 | mcp, context, loop, harness, memory, evaluation, tool-use, prompt-eng |
| 框架 | frameworks/langchain, frameworks/autogen, frameworks/crewai |
| LLM | llm/basics, transformers, tokenization, fine-tuning, prompting |
| 资讯 | news（静态精选 + 可后续 CMS） |

内容源：现有 `pages/**/*.html` 文案**扩写**，不是简单粘贴。

### 4.4 动画播放器（读者 + 作者预览共用）

- `AnimationPlayer` / `useAnimationPlayer`：play / pause / step / stepBack / reset / speed
- `prefers-reduced-motion`：静态步骤列表
- 控件无障碍：aria-label、键盘可操作

---

## 5. 安全与上线（强制）

| 领域 | 措施 |
|------|------|
| 认证 | JWT access + httpOnly refresh（或 access 短时 + 刷新）；密码 bcrypt |
| 授权 | 路由级 RBAC：`requireRole('author')` |
| 输入 | zod 校验；Markdown 渲染 **DOMPurify / sanitize-html** |
| 密钥 | `.env` 不入库；`.env.example` 仅占位；无前端暴露服务端密钥 |
| HTTP | helmet、cors 白名单、rate-limit（登录/注册/申请更严） |
| 错误 | 统一错误体，不泄露堆栈到生产 |
| Agent/BYOK | 仅文档：密钥不得记日志；本次无真实转发 |
| 部署 | 前端静态 + API 分离；健康检查；生产禁用 debug |

详见 `docs/security.md`（实现时补全）。

---

## 6. 前端组件化（高复用）

```
components/
  ui/           Button Card Tag Input Toggle Select Modal Tabs
  layout/       AppShell Header Footer MobileNav ProtectedRoute
  article/      ArticleLayout TOC CodeBlock CommentPlaceholder RelatedLinks MarkdownView
  anim/         AnimationPlayer AnimationControls templates/*
  author/       MarkdownEditor AnimationStepEditor ArticleMetaForm
  agent/        AgentFloat ExplainHotspot
  home/         KnowledgeCardGrid KnowledgeCardList ViewModeToggle
```

页面只负责组合与数据获取，不复制布局。

---

## 7. 实施阶段（可验证）

> 逐阶段实现情况以 `docs/dev-progress.md` 为准；此处仅保留原则与目标。

### Phase A — 脚手架与设计系统
- monorepo、web/api、tokens（修复 `:root` + dark）、AppShell、路由骨架  
**验收：** dev 起双端，主题切换正常 → **已完成**

### Phase B — 共享组件 + 动画引擎
- UI 组件、ArticleLayout、TOC、AnimationPlayer、至少 2 个模板（react + loop）  
**验收：** 示例文章可分步播放 → **已完成**（8 种 `VisualKind`，16 个模板映射）

### Phase C — 后端骨架 + Auth + RBAC
- Prisma、注册登录、me、中间件、agent 501  
**验收：** curl 登录拿到 token；无 token 不能 POST 文章 → **已完成**（agent 路由已实装，不再 501）

### Phase D — 作者端 CMS
- 工作台、MD 编辑器、动画模板编辑器、发布 API  
**验收：** 作者可写草稿、插动画、发布；读者可见 → **已完成**

### Phase E — 种子内容导入
- 全部 slug 长文 + 动画 JSON seed 脚本  
**验收：** 知识总览无死链；核心篇字数与结构达标 → **已完成**（`apps/api/prisma/seed-content.ts`）

### Phase F — 读者体验打磨
- 首页 Grid/List、申请作者、admin 审批、设置/个人页、资讯  
**验收：** 完整主路径手测 → **已完成**

### Phase G — 上线准备
- build、env、security checklist、architecture 文档、legacy 归档  
**验收：** `npm run build` 通过；安全清单勾选 → **进行中**（build 已通，安全 checklist 见 `docs/security.md`）

---

## 8. 明确不做（本版本）

> 当前未实现项与文档说明：详见 `docs/agent-modes.md` §3.2 与 `docs/dev-progress.md`。

- 站内 Agent 工具循环（tool-loop）/ 推理模式切换 UI / 完整智能体编排  
- 批注（`Annotation`）写入/审核 API（模型已建立，路由缺失）  
- 评论真实发布与审核  
- 自由画布级动画编排器  
- MCP Server 进程（仅占位接口）  
- 独立 Agent Runtime 服务（仅 README 占位）  
- 多租户计费、OAuth 社交登录（可后续）

---

## 9. 与旧代码关系

| 旧路径 | 处理 |
|--------|------|
| `pages/**`, `scripts/**`, `styles/**` | ✅ 2026-08 已移入 `_legacy/`（`git mv` 保留历史；目录已被 `.gitignore` 忽略） |
| `api/` 空目录 | 由 `apps/api` 替代 |
| 现有作者 dashboard / apply / home list | 交互与信息架构参考，React 重写 |

---

## 10. 验证清单（上线前）

- [ ] 全部种子文章可打开，TOC 与动画正常  
- [ ] 首页 Grid/List 切换且刷新保持  
- [ ] 读者注册登录；申请作者；admin 审批后进入作者端  
- [ ] 作者写 MD、建动画、发布；读者端立即可见  
- [ ] XSS 测试：恶意 MD 被消毒  
- [ ] 未授权访问 `/author/*` 与写接口被拒绝  
- [ ] `/api/v1/agent/*` 返回 501  
- [ ] 生产 build 无 secret 泄漏  

---

## 11. 开发命令（目标）

```bash
npm install
npm run dev          # 并发 web + api
npm run dev:web
npm run dev:api
npm run db:migrate
npm run db:seed      # 种子文章与动画
npm run build
```
