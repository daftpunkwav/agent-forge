# 生产数据库：PostgreSQL

> 开发默认仍为 SQLite（`apps/api/prisma/schema.prisma` + `file:./dev.db`），零依赖开箱。  
> 生产 / 多实例部署请切换到 PostgreSQL。

## 1. 启动 Postgres

```bash
docker compose up -d postgres
```

连接串（与 `docker-compose.yml` 一致）：

```
postgresql://agentforge:agentforge@127.0.0.1:5432/agentforge?schema=public
```

## 2. 切换 Prisma provider

编辑 `apps/api/prisma/schema.prisma`：

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

`apps/api/.env`：

```
DATABASE_URL="postgresql://agentforge:agentforge@127.0.0.1:5432/agentforge?schema=public"
```

然后：

```bash
cd apps/api
npx prisma generate
npx prisma db push
npm run db:seed
```

## 3. 注意

- SQLite → Postgres **不能**直接复用 `dev.db`；需重新 seed 或自行导出导入。
- 生产请更换强密码，并终止 TLS（由反向代理 / 托管方完成）。
- CI / 多 worker 不要用 SQLite 文件库。
