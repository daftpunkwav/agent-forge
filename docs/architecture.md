# AgentForge 架构说明

## 概览

Monorepo（npm workspaces）：

- `apps/web` — Vite + React + TypeScript 读者/作者端
- `apps/api` — Express + Prisma + SQLite（可换 PostgreSQL）
- `packages/shared` — 共享类型与常量
- `services/agent`、`services/mcp` — 未来独立服务占位
- `content/seed` — 可扩展内容资产（当前种子在 `apps/api/prisma/seed-content.ts`）

## 角色

`reader` → 申请 → `author`；`admin` 审批并拥有全部写权限。

## Agent 预留

- UI：`AgentFloat` 占位
- API：`POST /api/v1/agent/chat|explain`、`GET/POST /api/v1/agent/memory` → 501

## 安全要点

见 `docs/security.md`。

## 本地开发

```bash
npm install
cd apps/api && npx prisma db push && npm run db:seed
npm run dev:api   # 终端 1 → :3001
npm run dev:web   # 终端 2 → :5280（非默认 5173，避免端口冲突）
```

浏览器打开：**http://localhost:5280**

默认管理员：见 `.env.example` 中 `SEED_ADMIN_*`。
