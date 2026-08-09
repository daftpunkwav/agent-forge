# AgentForge — 产品与实施计划（修订版）

> **状态（2026-08-04）**：核心读者/作者/管理/双 Agent 主路径、批注读写、auth refresh、P0 tool-loop 已落地。  
> **未实现**：推理模式切换 UI（仅"允许工具"勾选）、MCP 进程、独立 Agent Runtime、Agent 自动审注、评论 CRUD。  
> 阶段实现情况详见 `docs/dev-progress.md`。  
> 下文 §1–§6 保留早期产品意图；其中「Agent 本次不实现 / 返回 501」「批注 API 未上线」等表述**已被后续实现取代**，以 `docs/architecture.md` 与代码为准。

---

## 1. 产品目标

**AgentForge（Agent 锻造坊）**：可上线的 Agent/LLM 学习平台。

| 能力 | 说明 | 当前 |
|------|------|------|
| 读者端 | 学习路径、富文本文章、可分步动画、注册登录、申请作者、话题社区 | ✅ |
| 作者端 | 工作台、Markdown、动画模板编辑、发布/草稿 | ✅ |
| 系统种子内容 | 核心知识点长文 + 配套动画（`seed-content.ts`） | ✅ |
| 站内 Agent | 悬停快讲 + 面板对话 + BYOK + 记忆/进度 + tool-loop（P0） | ✅ P0 tool-loop 已落地；模式选择 UI 待办 |
| 预留 | Agent 自动审注、MCP 进程、独立 Runtime、评论 | 批注读/写/审 API 已落地；其余占位 |

**设计原则：** 组件化、模块单一职责、可扩展 monorepo、安全默认、适合公开发布。

---

## 2. 已确认决策

| 决策点 | 选择 | 备注 |
|--------|------|------|
| 技术栈 | Vite + React + TypeScript；Express + Prisma | 已落地（Vite 8 / React 19 / Express 5） |
| 包管理 | npm workspaces（无 pnpm） | `apps/*` + `packages/*` |
| 动画作者工具 | 模板 + 步骤参数（非自由画布） | ✅ |
| 内容策略 | 系统种子长文 + 作者可续写 | ✅ |
| Agent | 站内双 Agent 已实现；P0 tool-loop 已落地；模式选择 UI 延后 | 取代早期「仅 501」决策 |
| 评论 | 不做交互后端 | 仍未实现 |
| 数据库（开发） | SQLite；生产可切 PostgreSQL | 默认 `file:./dev.db` |
| Web 端口 | **5280**（避免 5173 冲突） | `vite.config.ts` |

---

## 3. 目标架构

### 3.1 Monorepo（当前实际）

```
AgentForge/
├── package.json                 # workspaces + scripts
├── .env.example
├── apps/
│   ├── web/                     # 读者 + 作者 SPA
│   └── api/                     # REST API + Agent 路由
├── packages/
│   └── shared/                  # DTO、权限、悬停净化
├── services/                    # 未来独立服务（仅 README）
│   ├── agent/
│   └── mcp/
├── _legacy/                     # 旧静态站归档
└── docs/
```

早期规划中的 `content/seed/`、`docker-compose.yml`、`features/` 目录**未落地**；种子在 `apps/api/prisma/seed-content.ts`。

### 3.2 角色模型

```
guest  →  可读公开文章；可匿名 Agent；可注册
reader →  登录、个人主页、申请作者、话题
author →  工作台、MD / 动画编辑、发布（含 authorTier）
admin  →  审批申请、领域管理（adminLevel 分级）
```

详见 `docs/identity-permissions.md`。

### 3.3 路由地图（当前）

**读者端**：`/` · `/knowledge` · `/knowledge/:slug` · `/llm` · `/llm/:slug` · `/domains/:slug` · `/search` · `/news` · `/topics` · `/login` · `/register` · `/settings` · `/profile` · `/author/apply`

**作者端**：`/author` · `/author/articles/new|:id/edit` · `/author/animations/new|:id/edit` · `/author/applications`（admin）

**管理**：`/admin/domains`

**API（摘要）**：

```
POST/GET/PATCH  /api/v1/auth/{register,login,logout,me,refresh}
CRUD            /api/v1/articles · /animations · /domains · /topics
                /api/v1/author-applications
                /api/v1/annotations
                /api/v1/settings
                /api/v1/agent/{meta,providers,explain,chat,memory,progress,cache/clear}
GET             /api/v1/mcp/status   # reserved
GET             /health
```

无 comments API；其余路由均已落地。

### 3.4 数据模型要点

见 `apps/api/prisma/schema.prisma`（15 个模型）：User、RefreshToken、Domain、Article、AnimationDef、ArticleAnimation、Topic、TopicReply、AuthorApplication、Annotation、AgentConversation、AgentMessage、AgentMemory、LearningProgress、HoverExplainCache。

动画嵌入：`:::animation{id="..."}:::`

---

## 4–6. 功能规格 / 安全 / 组件（原则仍有效）

读者/作者规格、种子篇幅要求、动画播放器、安全基线、组件化原则仍以早期设计为准；**实现细节以 `docs/architecture.md`、`docs/security.md`、`docs/animation-system.md` 为准**。

特别更正：

- Agent 浮动面板**已可用**（非「即将推出」）
- JWT 为 **access + refresh**（refresh 旋转吊销、存 SPA localStorage；HttpOnly Cookie 迁移待办，见 `docs/httponly-cookie-migration.md`）
- 默认 LLM Provider 为 **StepFun**（可换 OpenAI / Generic / BYOK）
- 管理员密码**无内置兜底**，须 `SEED_ADMIN_PASSWORD`
- 批注 API **已上线**（`/api/v1/annotations` GET/POST/PATCH）

---

## 7. 实施阶段

| Phase | 内容 | 状态 |
|-------|------|------|
| A 脚手架与设计系统 | monorepo、tokens、AppShell | ✅ |
| B 组件 + 动画引擎 | VisualKind × 模板映射 | ✅ |
| C Auth + RBAC | Prisma、JWT(access + refresh)、中间件 | ✅（agent 已实装，非 501） |
| D 作者端 CMS | 工作台、MD、动画编辑、发布 | ✅ |
| E 种子内容 | `seed-content.ts` | ✅ |
| F 读者体验 | 首页、申请、审批、话题、资讯等 | ✅ |
| G 上线准备 | build、安全清单、文档、legacy 归档 | 🔄 build 已通；生产 DB/HTTPS/CI 待办 |

---

## 8. 明确不做 / 延后（当前版本）

- 站内 Agent 推理模式切换 UI（仅"允许工具"勾选 → `reasoningMode: react`，缺完整模式选择器）  
- Agent 自动审注（`allowAgentAnnotationReview` 字段已有，未接线）  
- 评论真实发布  
- 自由画布动画编排器  
- MCP Server 进程  
- 独立 Agent Runtime 进程  
- 多租户计费、OAuth 社交登录  

---

## 9. 与旧代码关系

| 旧路径 | 处理 |
|--------|------|
| `pages/**` 等静态站 | ✅ 已迁入 `_legacy/`（gitignore） |
| 根目录空壳 `api/` | 以 `apps/api` 为准 |

---

## 10. 验证清单（上线前）

- [ ] 全部种子文章可打开，TOC 与动画正常  
- [ ] 读者注册登录；申请作者；admin 审批后进入作者端  
- [ ] 作者写 MD、建动画、发布；读者端可见  
- [ ] XSS：恶意 MD 被消毒  
- [ ] 未授权访问 `/author/*` 与写接口被拒绝  
- [ ] `/api/v1/agent/explain`、`/explain/stream`、`/chat`、`/chat/stream` 在配置 Provider 后可用（**不再期望 501**）  
- [ ] P0 tool-loop（`reasoningMode: react` 或勾选"允许工具"）行为符合预期  
- [ ] `/api/v1/annotations` GET/POST/PATCH 工作：游客仅见 approved、读者提交 pending、作者/admin 审核  
- [ ] 生产 `JWT_SECRET` / `SEED_ADMIN_PASSWORD` / `CORS_ORIGIN` 已配置  
- [ ] 生产 build 无 secret 泄漏  

---

## 11. 开发命令

```bash
npm install
# 配置 apps/api/.env（见 .env.example；SEED_ADMIN_PASSWORD 必填）
cd apps/api && npx prisma db push && npm run db:seed && cd ../..
npm run dev:web    # :5280
npm run dev:api    # :3001
npm run build
npm test           # API Vitest
```

根脚本 `npm run dev` 仅提示分终端启动，不并发。
