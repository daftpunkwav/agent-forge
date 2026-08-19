# 模块化单体 → 微服务演进:架构与目录结构审查报告

> 审查日期:2026-08-19
> 审查范围:目录结构合理性 · 模块化单体符合度 · 源码级脱耦核验 · 向微服务架构的演进路径
> 审查性质:**只读审查 + 改造方案,未修改任何代码**
> 证据基准:仓库代码(工作区,含未提交的 ports 迁移改动)逐文件核验 + grep 依赖扫描 + `docker-compose.yml`/`package.json`/prisma schema 通读
> 参考设计:`D:\daftpunkwav\04-MyProjects\voyager\docs\architecture.md`(仅作方向参考,不照搬)
> 前置报告:`docs/reviews/architecture-decoupling-review-2026-08-09.md`(故障隔离/韧性,聚焦运行时);本报告聚焦**模块划分与边界**,与其互补

---

## 0. 一页结论

**当前目录结构与源码级脱耦,模块化单体已经达标;距离微服务架构,差距主要在"数据边界"与"独立运行能力",不在目录。** 具体:

| 维度 | 现状 | 判定 |
|------|------|------|
| 目录组织(按业务域分 workspace) | `apps/` · `packages/` · `services/` 三区清晰 | ✅ 合理 |
| 服务间源码 import | 除 `services/api` 组合根外,**零跨服务 import**(grep 实证) | ✅ 达标 |
| 跨服务接口(ports) | 全部收敛于 `packages/contracts/src/ports.ts` | ✅ 达标(未提交,施工中) |
| 前端与后端脱耦 | `apps/web` 仅依赖 `@core/contracts`,零后端 import | ✅ 达标 |
| 组合根唯一性 | `services/api/src/compose.ts` 是全仓唯一 import 所有服务的层 | ✅ 达标 |
| **数据边界** | **15 个模型同一张 prisma schema、同一数据库、跨域外键(Topic→Article、Annotation→Article、LearningProgress→Article)** | ⚠️ 单体强耦合点 |
| **独立运行能力** | 各业务域是"库",只有 `services/api` 可 listen;**无独立进程/端口/健康** | ⚠️ 未达"服务即进程" |
| **事件流/异步解耦** | 域间只有同步端口调用,无事件总线 | ⚠️ 缺(微服务非必需,但为演进预留) |
| 文档一致性 | `docs/architecture/overview.md` 仍描述旧 `apps/api`/`packages/shared` 结构 | ❌ 过期 |
| 测试覆盖 | identity/community 零测试;content 1 个 | ⚠️ 薄弱 |
| 死目录 | `openwiki/`(不在 workspaces,README 未提及)、根 `tests/` 空、`_legacy/` 已 gitignore 但仍在 | ⚠️ 需清理或说明 |

**结论:不需要推翻重来。** 目录结构是对的,继续微服务演进时**目录基本不用动**,要动的是三件事——①数据模型跨域外键断开、②每服务获得独立运行壳、③文档对齐。全部改造向后兼容、可分阶段落地。

---

## 1. 现状目录结构(核验后)

```
AgentForge/                        # 仓库根(Grimoire)
├── apps/
│   ├── web/                       # 前端:Vite 8 + React 19 + TS(仅依赖 @core/contracts)
│   ├── desktop/                   # 占位:仅 package.json + tsconfig,无 src
│   └── mobile/                    # 占位:同上
├── packages/
│   ├── contracts/                 # ★ 契约包:DTO / 权限矩阵 / hoverSanitize / LLM 类型 / ports
│   └── foundation/                # 基础设施:errors/logger/jwt/hash/byokCrypto/sse/中间件
├── services/
│   ├── identity/                  # 认证/用户/作者申请/设置 域
│   ├── content/                   # 文章/动画/领域/批注 域
│   ├── community/                 # 话题论坛 域
│   ├── agent/                     # 悬停/面板 Agent、记忆、tool-loop 域
│   ├── llm/                       # 无状态 LLM 网关(持有全部密钥)
│   ├── api/                       # ★ 宿主组合根:Express 装配 + prisma schema/seed + compose
│   └── mcp/                       # MCP 预留(仅 README + /api/v1/mcp/status 探测)
├── scripts/dev.mjs                # 统一开发启动(8180 web + 8181 api)
├── docs/                          # architecture / operations / roadmap / reviews
├── openwiki/                      # 代码 wiki(非 npm workspace,README 未提及)
├── _legacy/                       # 旧静态站归档(.gitignore 已忽略)
└── tests/                         # 空目录
```

**判定:目录结构合理。** 三区划分(`apps` 入口 / `packages` 共享 / `services` 业务域)是标准的 monorepo 模块化单体形态,与 voyager 的 `apps/services/platform/agent` 顶层划分方向一致(voyager 的 `platform` 对应这里的 `packages`)。命名按功能/职责,无品牌名污染(品牌集中在 `apps/web/src/app/brand.ts`)。

---

## 2. 源码级脱耦核验(实证)

### 2.1 依赖声明(npm workspaces)

| 包 | dependencies | 说明 |
|----|--------------|------|
| `@core/contracts` | (空) | 纯类型,零依赖 ✅ |
| `@core/foundation` | `@core/contracts` + express + zod + bcryptjs + jsonwebtoken + pino + @prisma/client | 机制层但绑定技术栈 |
| `@core/identity` | contracts + foundation + express + prisma + zod | |
| `@core/content` | contracts + foundation + express + prisma + zod | |
| `@core/community` | contracts + foundation + express + prisma + zod | |
| `@core/agent` | contracts + foundation + express + prisma + zod | |
| `@core/llm` | contracts + foundation | ✅ 最薄,无 prisma/express |
| `@core/api` | contracts + foundation + **identity/content/community/agent/llm(全部)** | 组合根,唯一 |
| `@core/web` | contracts + react + marked + dompurify | ✅ 无任何服务依赖 |

**服务之间零互相依赖** —— 这是模块化单体最核心的一条,已满足。

### 2.2 源码 import 扫描(全仓 `services/` + `apps/` + `packages/`)

```
grep -rn "@core/identity|@core/content|@core/community|@core/agent|@core/llm" 排除 dist/node_modules
→ 命中仅在 services/api/src(组合根)+ 各服务 index.ts 头部注释(非 import)
```

**除组合根外零跨服务 import。** ✅

### 2.3 跨服务接口(ports)

端口契约全部收敛于 `packages/contracts/src/ports.ts`(未提交,正在迁移):

- `UserSummaryPort` / `UserPreferencesPort`(identity 提供,content/community/agent 消费)
- `ArticleQueryPort`(content 提供,community/agent 消费)
- `LlmGatewayPort`(llm 提供,identity/agent 消费)

实现注入走组合根 `services/api/src/compose.ts`:`createIdentityRepository` → `users` 端口;`createContentRepository` → `articles` 端口;`createAgentRuntime({ prisma, users, articles, llm })`。**依赖方向全部自上而下,无环。** ✅

voyager 铁律"服务之间只允许 capability 调用 / 事件流 / 契约包"在本项目已落成"端口调用 + 契约包"——capability 注册表与 MCP 双生成尚未引入(见 §5),但对当前规模不是必需。

### 2.4 数据访问边界(prisma model 实际使用)

| 服务 | 访问的 model | 判定 |
|------|--------------|------|
| identity | user / refreshToken / authorApplication | ✅ 本域 |
| content | article / domain / animationDef / annotation / articleAnimation | ✅ 本域 |
| community | topic / topicReply | ⚠️ 经 FK 间接关联 article(见 §3.1) |
| agent | agentConversation / agentMessage / hoverExplainCache / agentMemory / learningProgress | ✅ 本域(学习进度表归 agent 域,合理) |
| agent 跨域 | `prisma.article` **已删除**——`/progress` 经 `articles.getArticleMetaBySlug` 端口校验(agent.ts:678 注释为证) | ✅ 已修正 |

> 注:agent 域持有 `learningProgress` 表。该表通过 `articleId` 关联文章,语义上属于"学习进度"子域,归 agent 域可接受,但跨域 FK 问题见 §3.1。

---

## 3. 主要问题与差距

### 3.1 【核心】数据模型跨域耦合:单一 schema、单一数据库、跨域外键

**证据**:`services/api/prisma/schema.prisma` 15 个模型一张表;`Topic.articleId → Article`、`Annotation.articleId → Article`、`LearningProgress.articleId → Article` 均为**跨域外键关系**;所有服务共享同一 PrismaClient 与同一 SQLite/Postgres。

**为什么是问题**:
- 模块化单体的数据边界靠"自律"(各服务只写自己的表),而非结构强制;新开发者很容易在 agent 服务里顺手 `prisma.article.findUnique`(事实上历史代码就出现过,agent.ts:678 才刚改掉)。
- 微服务化的**最大搬迁成本就是数据**:一旦外键在 DB 层存在,拆库时必须先断 FK、改跨库查询、处理分布式一致性。断外键越早,拆得越顺。

**voyager 的对应设计**:每个服务 `store.py`"独立命名空间",服务"不读写别人的数据表",需要别的领域的数据 → 调对方 capability。

### 3.2 业务域无独立运行壳(服务是"库"不是"进程")

**证据**:identity/content/community/agent/llm 均只有 `index.ts`(工厂函数),无 `rest.ts`/`main.ts`/独立 listen/独立端口/独立 env 前缀/独立健康检查。唯一可运行的进程是 `services/api`。

**为什么是问题**:
- 模块化单体允许"进程内聚合",但 voyager 设计(§13.1)要求"进入目录即可独立起进程"。当前形态下,**服务不能独立启动、独立重启、独立伸缩**——这正是微服务演进的第一块台阶。
- `npm run dev` 只能起一个进程;想单独压测/调试 agent 域必须起整个 api。

### 3.3 无事件流(异步解耦缺失)

**证据**:域间只有同步端口调用(await 函数);无事件总线、无订阅、无 `service.health.changed` 类事件;前端靠轮询/直接请求,无 SSE 事件订阅(除 agent 流式本身)。

**为什么是问题**:微服务架构的韧性来自异步事件解耦(故障不阻塞、可重放)。当前同步调用链意味着"community 调 content 端口时 content 抖动,community 就慢"。对当前规模可接受,但为演进应预留事件通道(见 §5)。

### 3.4 foundation 混入技术栈绑定

**证据**:`packages/foundation` 依赖 express + @prisma/client,`errorHandler.ts:26` 直接 `instanceof Prisma.PrismaClientKnownRequestError`。foundation 定位是"机制层",voyager 的 platform 铁律是"纯机制、不含业务、不绑定具体服务"。

**判定**:这是**低优先级**问题——Prisma 错误映射是通用 DB 错误规范化,不属于业务;但 foundation 因此无法被非 Prisma 的运行时复用。可接受,记录即可。

### 3.5 文档过期

**证据**:`docs/architecture/overview.md` 最后核对 2026-08-04,仍描述 `apps/api`(现已为 `services/api`)、`packages/shared`(现已拆为 contracts + foundation)、"services/agent 仅 README"(现已有完整实现)。README.md 已是新结构。

### 3.6 测试覆盖缺口

| 服务 | 测试数 |
|------|--------|
| identity | **0** |
| community | **0** |
| content | 1 |
| agent | 5 |
| llm | 2 |
| api | 1 |
| contracts / foundation | 2 / 5 |

业务域核心逻辑(认证、批注 ACL、话题)缺少独立测试,与"模块可独立验证"的模块化单体要求不符。

### 3.7 死目录与杂项

- `openwiki/`:非 npm workspace,README/文档均未提及——是代码 wiki 导出残留,应确认保留价值后移入 docs 或移除。
- 根 `tests/`:空目录。
- `_legacy/`:已 `.gitignore` 但仍占工作区(历史 git 跟踪矛盾,2026-08-04 报告 D-02 已提,未决)。
- `apps/desktop` / `apps/mobile`:空占位(合理,未来客户端)。
- `services/mcp`:空壳(合理,预留)。

---

## 4. 与 voyager 架构的对齐度

| voyager 概念 | Grimoire 现状 | 差距 |
|--------------|---------------|------|
| gateway 聚合入口 | `services/api`(组合根 + 统一限流/健康/就绪) | ✅ 已对齐 |
| platform/contracts(纯类型) | `packages/contracts` | ✅ 已对齐 |
| platform 机制库 | `packages/foundation` | ⚠️ 绑定 express/prisma(§3.4) |
| 服务 = 独立进程 + 自带队列 | 服务 = 库,无独立进程 | ⚠️ §3.2 |
| 服务独立数据命名空间 | 单一 schema + 跨域 FK | ⚠️ §3.1 |
| 事件流(eventbus) | 无 | ⚠️ §3.3 |
| capability 注册表 → REST + MCP 双生成 | 手写 REST 路由 | ⚠️ 非必需,当前规模不值得引入 |
| 服务 settings.py 自带设置项 | 无(设置集中在 identity) | 差异可接受 |
| agent 不写业务库表 | agent 只写本域表,文章校验走端口 | ✅ 已对齐 |

**结论:Grimoire 在"组合根 + 契约包 + 端口注入"三条主线上已与 voyager 对齐;剩余差距集中在数据边界与独立运行,这两项也正是微服务化的真正门槛。**

---

## 5. 改造方案(向微服务靠拢,分三阶段,全部向后兼容)

> 总原则:**目录不动,先断数据耦合,再补运行壳,最后才谈进程拆分。** 每一步独立可交付、可回滚、可验证。不需要一次性拆成微服务——模块化单体 + 强边界 = 随时可拆的架构。

### 阶段 A:数据边界硬化(先做,收益最大、风险最低)

| # | 改动 | 说明 |
|---|------|------|
| A-1 | **跨域外键改纯 ID 字段** | `Topic.articleId`、`Annotation.articleId`、`LearningProgress.articleId` 去掉 `@relation`,保留 String 字段(community 已注入 `ArticleQueryPort.getArticleIdBySlug` 做应用层校验——端口校验已就位,断 FK 是自然的下一步)。schema 加注释:`// 跨域引用,仅存 ID,关联经 content 端口` |
| A-2 | **prisma schema 按域分组 + 注释** | 同一文件内用注释段标注 `// ---- identity 域 ----` / `// ---- content 域 ----`,明确每个模型的属主域;未来拆库时按段搬迁 |
| A-3 | **新增跨域访问 lint 规则** | 服务内 `prisma.<他域model>` 触发告警。实现:`oxlint` 插件或简单 CI grep(如 `services/agent/src` 内不允许出现 `prisma.article`)。这是把"自律"变成"结构强制"的关键一步 |
| A-4 | **补 identity/community 测试** | 为认证/刷新令牌、话题 ACL 补 Vitest(用内存或 test DB),兑现"每域可独立验证" |

**验证**:`npm run build` + `npm test` 全绿;`grep -rn "prisma.topic\|prisma.article" services/agent/src` 为空;`prisma db push` 正常(仅 schema 关系变化,无数据迁移)。

### 阶段 B:服务获得独立运行能力(向"服务即进程"迈一步)

| # | 改动 | 说明 |
|---|------|------|
| B-1 | **每服务加独立 REST 壳** | `services/<域>/src/server.ts`:读自己的 env 前缀(`IDENTITY_PORT` 等,默认 8182+)、`createXxxRouters(...)` 后 listen,复用 `@core/foundation` 的 logger/errorHandler/sse。**业务代码零改动** |
| B-2 | **组合根保留两种启动模式** | `services/api`(单体,现状)与各服务独立启动并行;env 如 `SERVICE_MODE=standalone` 控制。**单体模式是默认与开发模式**,独立启动是演进验证 |
| B-3 | **每服务暴露 `/health`** | 复用 api 的 liveness 模式,为未来 LB 探活做准备 |
| B-4 | **openwiki 处置确认** | 保留则纳入 docs 索引或移到 docs/;否则删除。根 `tests/` 空目录删除 |

**验证**:`npm run dev:api` 行为不变;`IDENTITY_PORT=8182 npx tsx services/identity/src/server.ts` 可独立启动并响应 `/health`;`npm test` 全绿。

### 阶段 C:异步解耦与可选拆分(按需,不强制)

| # | 改动 | 说明 |
|---|------|------|
| C-1 | **事件总线预留** | 在 `packages/contracts` 定义事件类型(`article.published`、`prefs.changed` 等),先做进程内 EventEmitter 实现,服务可 pub/sub;未来换 Redis Streams 即可跨进程 |
| C-2 | **agent 域独立 DB 评估** | agent 表(conversation/memory/hoverCache/progress)与内容域无外键后,可先迁到独立 SQLite/PG 库(env `AGENT_DATABASE_URL`),验证"拆库"可行性 |
| C-3 | **服务级设置项下沉** | 仿 voyager 各服务自带 `settings.py`,把 identity 集中的设置按属主域拆分声明(远期,当前设置量小,可不做) |

**验证**:事件订阅单测;agent 独立 DB 启动 + `npm test` 全绿。

---

## 6. 依赖矩阵(目标态)

```
apps/web            → @core/contracts
packages/foundation → @core/contracts
services/identity   → contracts + foundation          (本域表 + 端口调用)
services/content    → contracts + foundation
services/community  → contracts + foundation + ArticleQueryPort(content 提供)
services/agent      → contracts + foundation + ArticleQueryPort + UserQueryPort + LlmGatewayPort
services/llm        → contracts + foundation
services/api        → 全部(组合根,唯一允许)
```

**禁止(CI 扫描强制)**:
- 服务间 import 实现代码(除组合根)
- 服务读他域数据表(A-3 lint)
- 服务写他域数据表
- `apps/*` import 任何服务
- 新增服务必须复制现有模式(工厂 + 端口 + 本域表),不许碰其他目录

---

## 7. 建议落地顺序(等待审核)

1. **阶段 A(数据边界)**——改动小、风险低、直接兑现"源码分离"的完整性
2. **阶段 B(独立运行壳)**——架构从"单进程单体"变为"可拆的单体"
3. **阶段 C(事件流/独立 DB)**——按业务需要再上,非当前必须

> 与 2026-08-09 韧性报告的关系:该报告 P0–P2 聚焦故障隔离(熔断/舱壁/优雅关闭/代码分割),多数已落地(见 `app.ts` 的 `/health`/`/ready` 与 `index.ts` 的优雅关闭)。本报告是**架构层**的补充,不重复其内容;两报告合起来 = "边界干净 + 运行时坚韧"。

---

*报告完。以下为审查中核验但未改动的项目:未创建/删除任何文件,未运行任何会改变状态的命令。*
