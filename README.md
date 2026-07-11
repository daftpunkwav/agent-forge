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

- **读者**：首页 Grid/List、知识/LLM 文章、TOC、动画播放、登录注册、申请作者
- **作者**：工作台、Markdown 编辑+预览、动画模板步骤编辑、发布
- **管理**：作者申请审批
- **预留**：评论、站内 Agent 对话（API 501）

## 目录

```
apps/web          前端
apps/api          后端与 Prisma
packages/shared   共享类型
docs/             架构与安全
services/         未来 Agent/MCP
```

详见 `PLAN.md` 与 `docs/architecture.md`。
