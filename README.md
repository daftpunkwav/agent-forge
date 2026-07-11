# AgentForge — Agent 锻造坊

交互式 Agent / LLM 学习平台：富文本教程、可分步动画、读者与作者双端。

## 技术栈

| 层 | 技术 |
|----|------|
| Web | Vite · React 19 · TypeScript · React Router |
| API | Express · Prisma · SQLite · JWT · Zod |
| 共享 | `@agentforge/shared` |

## 快速开始

```bash
npm install

# 数据库与种子（富文本 + 动画）
cd apps/api
npx prisma db push
npm run db:seed
cd ../..

# 两个终端
npm run dev:api
npm run dev:web
```

- 站点：http://localhost:5280 （固定端口，避免与其它 Vite 项目的 5173 冲突）  
- API：http://localhost:3001/health  

默认管理员（可在 `apps/api/.env` 修改）：

- 邮箱：`admin@agentforge.local`
- 密码：`ChangeMe_Admin_123!`

## 功能

- **读者**：首页、知识/LLM 文章、话题、悬停快讲与行内卡片 Agent、登录注册
- **作者**：工作台、Markdown 编辑、动画编辑、发布；可申请优秀作者
- **管理**：领域管理、申请审批（分级 adminLevel）
- **双 Agent**（详见 `docs/agent-modes.md`）  
  - **悬停 Agent**：速度优先，Fast Direct，记忆/上下文注入 + 缓存  
  - **Agent 面板**：目标为完整智能体（工具循环、会话、记忆、推理模式）；当前已有会话与记忆，工具 loop 建设中  
- **预留**：MCP（`services/mcp`）、独立 Agent Runtime（`services/agent`）

## 目录

```
apps/web          前端
apps/api          后端与 Prisma
packages/shared   共享类型与权限
docs/             架构 · Agent 模式 · 身份权限 · 安全
services/         Agent Runtime / MCP 占位
```

详见 `docs/architecture.md`、`docs/agent-modes.md`、`PLAN.md`。
