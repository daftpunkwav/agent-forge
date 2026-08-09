# 多实例部署与韧性组件语义（P2-4）

> 配套改造：`docs/architecture-decoupling-review-2026-08-09.md`（R-01/R-02/R-03/R-05/R-06/R-07/R-08/R-09/R-10/R-11/R-12）。

## 单进程 vs N 副本：各韧性组件的语义变化

| 组件 | 单实例语义 | N 副本语义 | 对策 |
|------|-----------|-----------|------|
| R-02 并发舱壁（`LLM_MAX_CONCURRENT`） | 全局 ≤N 并发 | 每实例 ≤N（总量 ×副本数） | 按副本数下调 `LLM_MAX_CONCURRENT`（如 3 副本设 4） |
| R-01 熔断 | 全局熔断 | 每实例独立熔断（有实例滞后半开） | 可接受；需强一致时换 Redis 共享状态 |
| 限流（express-rate-limit） | per-IP 全局限额 | per-IP per-实例（实际 ÷N） | `rate-limit-redis` store；接口已是标准 `stores` 选项，改动 <20 行，**需要时再上** |
| hoverCache L2 / 会话 / 记忆 | DB 共享 | 天然共享 | 无需改 |
| R-11 用户上下文短缓存（进程内 60s） | TTL 最坏不一致窗口 60s | 同上（每实例各一份） | 可接受；设置变更靠 `invalidateUserContext` 主动失效 |
| 认证 | 无状态 JWT | 天然横向 | 无需 sticky session |

## 扩容判断标准

单进程 event loop 延迟 p99 >100ms、或 CPU 持续 >70%、或 `/ready` 抖动 →
先垂直扩容；再不够 → 切 PostgreSQL（`docs/postgres.md`）+ 多副本 + Redis store。

## 部署检查清单

1. **健康/就绪**：LB 与容器探针一律打 `/health`（liveness）与 `/ready`（readiness，DB 不可用时 503 摘流）；两者都在限流器之前，不消耗限流预算。
2. **优雅关闭**：滚动发布发 SIGTERM；进程 10s 宽限后强退（日志 `shutdown: stop accepting…` → `prisma disconnected, bye`）。
3. **关键 env**（R-07，缺失直接拒启动）：`JWT_SECRET`（生产 ≥32 且非示例值）、生产 `DATABASE_URL` 必须显式。
4. **可选 LLM env**：缺失仅 warn 降级启动，Agent 域对无 BYOK 用户返回 NO_PROVIDER 文案，其余 8 个业务域完全正常。

## Redis 预留

`apps/api/src/app.ts` 与 `apps/api/src/routes/agent.ts` 中的 rateLimit 均使用默认 MemoryStore；
需要跨实例一致限流/熔断时：

```ts
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';

const redis = createClient({ url: process.env.REDIS_URL });
await redis.connect();

const generalLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  store: new RedisStore({ sendCommand: (...args) => redis.sendCommand(args) }),
});
```
