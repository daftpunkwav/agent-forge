# 生产部署指南

本地优先项目上公网/局域网的安全部署指引。覆盖:暴露面收缩、反向代理 + TLS、CSP、防火墙、环境变量与容器运行。

> 相关:数据库见 [postgres.md](postgres.md),多实例见 [multi-instance-deployment.md](multi-instance-deployment.md)。

## 部署形态总览

```
浏览器 ──HTTPS──▶ 反向代理(Caddy/nginx) ─┬─ /api/* ─▶ API 容器 (8181, HOST=0.0.0.0)
                                          └─ 静态   ─▶ 前端 build 产物 (apps/web/dist)
```

- **前端**:Vite build 产物(apps/web/dist)静态托管,由反向代理伺服。
- **API**:容器化运行,仅接受反向代理转发;**容器端口不要直接暴露到公网**。
- 开发服务(dev:web/dev:api)默认仅绑定 `127.0.0.1`,切勿直接用于对外服务。

## 1. 暴露面收缩(必做)

| 项 | 要求 |
|----|------|
| 绑定地址 | 开发默认 `127.0.0.1`(仅本机);容器内需显式 `HOST=0.0.0.0`(docker-compose 已设) |
| 容器端口 | **只发布反向代理端口**(如 443/80);API 的 `8181`、Postgres 的 `5432` 不要 `ports:` 映射到宿主机公网网卡 |
| 防火墙 | 云安全组/主机防火墙仅放行 80/443 到反向代理;管理端口(SSH)按最小来源限制 |
| 探针 | 使用 `/health`(liveness)与 `/ready`(readiness,DB 深度检查),勿将两者暴露给公网 |

`docker-compose.yml` 当前把 `5432`/`8181` 映射到宿主机所有网卡——**生产部署时应删除这两个 `ports:` 映射**,只让容器网络内部可达,由反向代理(可在同一 compose 网络或宿主机)访问。

## 2. 反向代理 + TLS(Caddy 最简示例)

Caddy 自动签发/续期 HTTPS 证书,并在响应头附加 CSP 与安全头:

```caddyfile
# Caddyfile
forge.example.com {
    encode gzip

    # 前端静态产物
    root * /srv/agentforge/web/dist
    try_files {path} /index.html

    # API 反代(容器网络内部)
    reverse_proxy /api/* api:8181
    reverse_proxy /health api:8181
    reverse_proxy /ready api:8181

    # 安全响应头:CSP 限制 connect-src(SSE/WS 与 API 来源),防 XSS 数据外带
    header {
        Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://forge.example.com"
        X-Content-Type-Options "nosniff"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

- `connect-src 'self'` 已覆盖同源 API/SSE;若前端直连跨源 API,把该来源加入 `connect-src`(本示例为同源反代,无需)。
- **`/docs` 不随生产暴露**:API 的 Swagger UI 仅在 `NODE_ENV !== 'production'` 挂载;生产构建无需反向代理该路径(上面未反代 `/docs`)。
- nginx 等价配置:`location /api/ { proxy_pass http://api:8181; proxy_set_header Host $host; }`,并自行管理证书。

## 3. 环境变量(生产必填,fail-fast)

API 启动时 `validateEnv` 校验,缺失**直接拒启动**并打印原因:

| 变量 | 必填 | 说明 |
|------|------|------|
| `NODE_ENV=production` | ✅ | 关闭 `/docs` 挂载、启用生产 CORS 严格白名单 |
| `JWT_SECRET` | ✅ | ≥32 字符,禁用示例值;轮换见安全文档 |
| `DATABASE_URL` | ✅ | PostgreSQL 连接串(勿用 SQLite 文件库多实例) |
| `CORS_ORIGIN` | ✅ | 逗号分隔的前端来源白名单,如 `https://forge.example.com`;**漏配会拒绝全部跨源请求** |
| `HOST` | 容器内 | 默认 `127.0.0.1`;容器/反代后设 `0.0.0.0` |
| `PORT` | - | 默认 8181 |
| `STEPFUN_API_KEY` 等 | 可选 | LLM Provider;缺失时 Agent 域降级为仅 BYOK |

> `docker compose` 已用 `${VAR:?}` 强制 JWT_SECRET/CORS_ORIGIN 必填,与启动期校验双保险。

## 4. 容器运行

- 镜像 `apps/api/Dockerfile`:多阶段构建 + `--omit=dev` + **非 root(`USER node`)**。
- 示例(docker compose 完整栈见仓库 `docker-compose.yml`):

```bash
docker build -f apps/api/Dockerfile -t agentforge-api .
docker run -d --name agentforge-api \
  -e NODE_ENV=production -e HOST=0.0.0.0 -e PORT=8181 \
  -e DATABASE_URL='postgresql://...' -e JWT_SECRET='<32+ chars>' \
  -e CORS_ORIGIN='https://forge.example.com' \
  -e STEPFUN_API_KEY='...' \
  -p 127.0.0.1:8181:8181   # 仅回环发布;公网入口走反向代理
  agentforge-api
```

- 只读文件系统建议:`--read-only`(API 无本地写依赖;会话/记忆在 DB)。
- 探针:compose 已含 `/ready` healthcheck;K8s 用 `livenessProbe: /health` + `readinessProbe: /ready`。

## 5. 安全清单(上线前逐项勾)

- [ ] 生产 `JWT_SECRET` ≥32 字符且非示例值(启动期自动校验)
- [ ] `CORS_ORIGIN` 为精确前端域名(含端口,不含通配)
- [ ] 容器 `8181`/`5432` 未映射到公网网卡;反代只暴露 80/443
- [ ] `POSTGRES_PASSWORD` 已设置强口令(compose 已 `${VAR:?}` 强制,禁用示例值)
- [ ] `TRUST_PROXY` 仅在反代后设为 `1`(防伪造 X-Forwarded-For 绕过限流)
- [ ] 生产 build 无 secret 泄漏(见 PLAN.md 上线清单)
- [ ] 默认管理员密码 `SEED_ADMIN_PASSWORD` 已设置为强口令,seed 后移除
- [ ] 依赖审计:CI 已跑 `npm audit`;Dependabot 每周自动提更新
