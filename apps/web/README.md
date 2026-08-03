# @agentforge/web

AgentForge 前端：Vite 8 + React 19 + TypeScript + React Router 7。

## 开发

在仓库根目录：

```bash
npm install
npm run dev:web
```

- 地址：http://127.0.0.1:5280（`strictPort`，避免与其它 Vite 项目的 5173 冲突）
- `/api` 代理到 `http://127.0.0.1:3001`
- 需同时运行 `npm run dev:api`

可选：复制根目录 `.env.example` 中的 `VITE_API_BASE_URL`（默认走代理时可不配）。

## 目录

```
src/
  app/router.tsx     路由
  pages/             读者 / 账户 / author / admin
  components/        agent · anim · article · domain · home · layout · ui
  hooks/             useAuth · useTheme · useAnimationPlayer
  lib/               api · agentStream · hoverExplainCache · markdown …
  styles/            tokens.css · global.css
```

## 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | Vite 开发服务器 |
| `npm run build` | 生产构建 |
| `npm run lint` | oxlint |

更多架构说明见仓库根 `README.md` 与 `docs/architecture.md`。
