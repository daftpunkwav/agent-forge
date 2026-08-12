# AgentForge 全面审查报告

> 审查日期：2026-08-04  
> 审查基准：仓库当前工作树；代码基准 commit `224cfdb` 及其后仅存在的既有未跟踪文件 `docs/reviews/architecture-review-2026-08-04.md`  
> 审查性质：只读审查。**未修改任何既有源码、配置、文档或删除文件。**  
> 报告版本：1.0

## 0. 执行摘要

AgentForge 已具备一套相对清晰的 monorepo 基础：`apps/api`、`apps/web`、`packages/shared` 的职责边界明确；API 使用 Express 5、Prisma 6、Zod、Helmet、Pino；前端使用 React 19、Vite 8、TypeScript；LLM Provider、工具循环、权限矩阵与净化逻辑均有显式扩展点。安全关键路径不是“裸奔”状态，JWT refresh 轮换、BYOK AES-256-GCM、BYOK URL 主机策略、SSE 中断与 LLM 错误脱敏均已实现，且核心单元测试通过。

本次审查的核心结论是：**项目总体工程质量良好，但“浏览器令牌暴露面”和“LLM 工具结果进入提示词的信任边界”仍是最高优先级安全事项；前端首屏分包、渲染异常恢复、路由权限复用、路由集成测试与文档治理是最具投入产出比的工程改进。**

### 结论速览

| 维度 | 评级 | 结论 |
|---|---:|---|
| 安全 | B- | 防护意识和基础设施较强；localStorage token、Observation prompt injection、DNS rebinding 仍需处理 |
| 架构与分层 | B+ | monorepo 与 LLM 子系统边界清晰；Agent 路由/前端 Agent 组件偏胖 |
| 代码质量与规范 | B | 类型与错误处理整体统一；lint 无 error 但有 9 条 warning，存在重复与部分宽类型 |
| 维护性 | B- | 代码可追溯、共享逻辑较好；文档漂移、死目录、巨型文件提高认知成本 |
| 扩展性 | B+ | Provider、Tool、Permission、Animation Template 都有注册式扩展点；SSE/Provider URL 有重复实现 |
| 测试与验证 | C+ | API/shared 104+4 个测试通过；CRUD 路由、前端、E2E、覆盖率门槛明显不足 |
| 现代化与部署 | B- | 技术栈现代；首屏 bundle 542.31 kB gzip 166.55 kB，CI 缺 lint/audit，缺应用容器与优雅停机 |
| 文档一致性 | C+ | 已有大量设计文档；README、架构文档、env 示例与实现存在可验证漂移 |

### 风险分布

- **Critical：1 项**：浏览器 localStorage 保存 access/refresh token，XSS 后可持久接管。
- **High：5 项**：工具 Observation 未建立不可信内容边界；BYOK DNS rebinding；生产错误回显依赖 NODE_ENV；缺少关键授权审计；Agent/tool 成本放大防护不足。
- **Medium：10 项**：前端分包、ErrorBoundary、路由守卫、SSE 重复、组件过胖、日志脱敏、输入大小、用户级限流、JWT 算法显式约束、部署完整性等。
- **Low/Observation：若干**：死目录、字符串状态字段、模块级单进程缓存、seed console、文档与测试目录治理等。

> 严重性是风险排序，不等于已被利用。所有结论均在“证据与可信度”中区分已核验事实和推断风险。

---

## 1. 审查范围、方法与限制

### 1.1 覆盖范围

- 顶层 workspace、构建脚本、环境变量模板、`.gitignore`、CI、Compose 与部署资料。
- API：入口中间件、认证授权、路由、Agent 编排、LLM Provider/Adapter、Tool Loop、BYOK、Prisma schema、日志与错误处理。
- Web：路由、认证 token、API/SSE 出口、Markdown 清洗、Agent 组件、页面守卫、构建产物。
- Shared：权限矩阵、悬停答案净化、共享类型。
- 测试与文档：已有测试、文档与代码交叉对账。

### 1.2 方法

1. 只读目录/引用/配置扫描与关键文件阅读。
2. 并行架构、安全、质量/测试探索，再由主审合并重复项。
3. 运行仓库已有 `npm test`、`npm run lint`、`npm run build`；未运行真实数据库、外部 LLM、浏览器 E2E 或生产部署。
4. 报告只新增本报告文件，不对被审查代码做修复性修改。

### 1.3 限制

- 未进行动态渗透测试、依赖 CVE 数据库在线核对、压力测试、真实 SSRF/DNS rebinding 验证或生产配置审计。
- `npm test` 使用项目现有测试替身；通过不代表完整端到端行为无缺陷。
- 安全问题中的“可利用”表述是基于代码路径的风险判断，不是已在真实环境成功利用的证明。

---

## 2. 系统画像与数据流

```text
浏览器 React/Vite
  ├─ REST：apps/web/src/lib/api.ts
  ├─ SSE：apps/web/src/lib/agentStream.ts
  ├─ token：apps/web/src/lib/apiToken.ts -> localStorage
  └─ Markdown：marked -> DOMPurify -> dangerouslySetInnerHTML
              │
              ▼
Express API
  helmet -> CORS -> JSON 1 MB -> requestId/日志 -> 限流
  routes -> middleware(validate/auth) -> Prisma/services/lib
              │
              ├─ Agent orchestrator / conversation / memory / cache
              ├─ LLM providers -> Anthropic/OpenAI adapters -> fetch
              └─ Tool loop -> whitelist + Zod + timeout -> published articles
              │
              ▼
Prisma 6 -> SQLite 默认 / PostgreSQL 可选
```

### 2.1 边界评价

- **已核验优点**：前后端通过 REST/SSE 解耦；`packages/shared` 复用权限与净化规则，减少双端漂移；LLM 适配器独立于路由。
- **主要耦合**：`apps/api/src/routes/agent.ts` 同时承担路由、SSE 生命周期与流控；`apps/web/src/components/agent/AgentFloat.tsx` 同时承担悬停 UI、面板 UI、计时器、节流与缓存交互。
- **合理取舍**：当前 CRUD 路由使用 fat-handler，没有立即引入 controller/repository 的必要；在功能继续增长前，优先抽“稳定重复的策略/流程”，而不是全面重构。

---

## 3. 安全审查

### SEC-01 — Critical：access/refresh token 均存于 localStorage

**证据（已核验）**

- `apps/web/src/lib/apiToken.ts:3-22` 使用 `localStorage` 保存与读取 token。
- `apps/web/src/hooks/useAuth.tsx` 依赖该存储完成会话恢复。
- 服务端 access 约 15 分钟、refresh 约 7 天；刷新令牌入库 hash 并旋转吊销，见 `apps/api/src/lib/jwt.ts`、`apps/api/src/routes/auth.ts`。
- 仓库已有 `docs/roadmap/httponly-cookie-migration.md`，说明这是已识别但尚未落地的设计项。

**影响与判断**

这不是“当前必然存在 XSS”的证明，而是令牌的暴露面：一旦任意作者内容、LLM Markdown 清洗回归或前端依赖引入可执行脚本，脚本可直接读取 refresh token，并在其有效期内持续换取 access token。可信度：**高**。

**建议**

优先迁移 refresh token 到 `HttpOnly; Secure; SameSite` cookie；access token 只存内存，刷新走受保护 cookie。迁移时补充 Origin/CSRF 策略、登出/轮换兼容与旧客户端过渡，不要通过关闭认证来规避迁移成本。

### SEC-02 — High：Tool Loop Observation 未建立不可信内容边界

**证据（已核验）**

`apps/api/src/lib/llm/tools/toolLoop.ts` 将工具执行结果直接拼成 user message，再送回 LLM。工具可读取已发布文章，而文章正文由半信任内容生产者写入。现有白名单、Zod、8 秒工具超时、最多 5 轮与审计日志不能替代提示词信任边界。

**影响与判断**

恶意文章可以包含伪装成系统/开发者指令的文本，影响后续模型行为。该风险是 prompt injection，不等同于代码执行，但可能导致越权式回答、工具滥用或内容污染。可信度：**高**。

**建议**

Observation 使用明确结构化标记与长度上限；将外部文章内容标为不可信数据；工具返回 DTO 而非任意长 Markdown；在 loop 中限制可影响决策的字段；补充恶意文章内容的回归测试。

### SEC-03 — High：BYOK URL 仅做 hostname 检查，未做解析后 IP 二次校验

**证据（已核验）**

`apps/api/src/lib/byokUrlPolicy.ts` 检查私网、环回、metadata、特殊主机名等，但未见调用前 DNS 解析并锁定结果；Provider adapter 最终使用 `fetch` 访问用户提供的 base URL。

**影响与判断**

在用户可控制 DNS 的场景中，公网解析通过、请求时解析到内网/metadata 地址的 rebinding 窗口理论上存在。当前审查未执行真实 DNS 攻击，可信度：**中高**。

**建议**

请求前解析所有 A/AAAA 记录并逐一执行 IP 策略；请求连接应绑定已校验地址，禁用自动重定向或对每次重定向重新校验；为该策略补 DNS/redirect 测试。

### SEC-04 — High：生产错误脱敏依赖显式 NODE_ENV

**证据（已核验）**

`apps/api/src/middleware/errorHandler.ts` 以 `process.env.NODE_ENV === 'production'` 决定是否把错误消息替换为通用文案。若生产运行环境遗漏变量，默认分支可能回显底层错误消息。

**影响与判断**

Prisma/网络错误可能暴露字段、路径或 Provider 细节。这里是配置失误导致的防护降级，可信度：**中**。

**建议**

采用 fail-closed 的运行模式判断；启动时对 production 配置显式校验；客户端永不回显 stack/diagnostic，详细信息仅进入脱敏日志。

### SEC-05 — High：Agent/tool 循环的成本放大与限流粒度不足

**证据（已核验）**

- Agent 路由采用 IP 级限流，工具 loop 最多可进行多轮 LLM 调用。
- 普通 chat 与 ReAct/tool-loop 共用 Agent 限流；未见以 `userId` 为主键的用户级预算/配额。

**影响与判断**

匿名或单一用户可用较少请求触发多次 Provider 调用，带来成本耗尽与资源争用风险。当前未做压力测试，可信度：**中高**。

**建议**

对 react/tool 路径单独限流，按已认证 userId 与 IP 组合计数；增加每用户/租户的 token、并发与日预算；为失败重试和 loop 迭代记录成本指标。

### SEC-06 — High：提权操作缺少完整审计记录

**证据（已核验）**

`apps/api/src/routes/applications.ts` 在批准申请时更新用户角色/等级与申请状态，但审查到的写入未持久化审批人、来源 IP/UA 或独立审计事件；现有 Pino 业务日志不足以替代可查询审计记录。

**影响与判断**

管理员误操作或账号被盗后，无法可靠回答“谁在何时将谁提升为何权限”。可信度：**中高**。

**建议**

增加 `reviewedById`/审计事件模型或不可变审计日志；记录 subject、actor、旧值、新值、requestId、时间与结果；对失败事务也记录原因。

### SEC-07 — Medium：日志可能记录敏感 URL/query

**证据**

`apps/api/src/app.ts` 请求日志与 `errorHandler.ts` 使用 `req.originalUrl`。若未来接口把 token、临时签名或敏感参数放入 query，日志聚合系统会保存原值。

**建议**

日志只记录 pathname；对 authorization/cookie/query 做 Pino redact；建立日志字段约定并测试。

### SEC-08 — Medium：JWT 验证未显式限制算法

**证据**

`apps/api/src/lib/jwt.ts` 调用 `jwt.verify(token, secret())`，审查未看到显式 `{ algorithms: ['HS256'] }` 约束。

**影响与判断**

jsonwebtoken 版本与 secret 校验提供一定默认保护，但显式算法白名单更能防配置/依赖变化造成的算法混淆。可信度：**中**。

**建议**

签发与验证均集中定义算法常量，验证时显式传入白名单，并增加伪造算法回归测试。

### SEC-09 — Medium：JWT/加密密钥配置存在占位或耦合风险

**证据**

- `.env.example` 包含公开的 `JWT_SECRET` 占位字符串；代码主要检查长度。
- `byokCrypto.ts` 在独立 BYOK key 缺失时可从 JWT secret 派生。

**影响与判断**

直接复制示例并未替换密钥会导致 token 可伪造；轮换 JWT secret 还可能使历史 BYOK 无法解密。是否在生产误用取决于部署流程，可信度：**中**。

**建议**

拒绝已知占位符；强制独立 `BYOK_ENCRYPTION_KEY`；启动时记录版本化密钥状态但不记录密钥内容；提供显式密钥迁移流程。

### SEC-10 — Medium：内容与请求大小约束不够领域化

**证据**

全局 JSON body 限制为 1 MB，但文章 markdown、动画步骤/config 等领域字段还需依赖各路由 schema/字符串字段约束；审查未发现统一的内容大小策略。

**影响**

大文章/动画配置可造成数据库膨胀、序列化与前端渲染压力。可信度：**中**。

**建议**

为 markdown、动画步骤、标签与搜索参数建立显式 max/depth/数量限制；数据库与 API 限制保持一致；增加边界测试。

### 已确认的安全正面项

- bcryptjs 12 轮哈希；认证失败文案不区分邮箱/密码。
- refresh token hash 入库并使用原子旋转/吊销逻辑。
- BYOK 使用 AES-256-GCM，密文前缀区分版本。
- BYOK hostname 黑名单覆盖 localhost、私网、metadata 等常见类别。
- Helmet、CORS 白名单、JSON body 限制、全局/认证/Agent 分级限流均已装配。
- LLM 错误将诊断信息与客户端文案分离；SSE close/abort 路径有专门测试。
- Markdown 经 marked + DOMPurify；该防线仍应与 HttpOnly 迁移组合，而不是单独视为令牌保护。

---

## 4. 架构、耦合与扩展性

### ARC-01 — High：Agent API 路由承担过多职责

`apps/api/src/routes/agent.ts` 约 722 行，同时包含请求 schema、SSE 初始化/帧协议、abort 生命周期、thinking 门控、缓存与持久化收尾。`agentOrchestrator.ts` 已抽出部分上下文编排，但两个流式端点仍有重复。

**建议**：抽出稳定的 SSE session/stream runner，统一 delta、thinking、abort、finalize 生命周期；路由只组装输入、授权与调用。

### ARC-02 — High：AgentFloat 是高状态密度巨型组件

`apps/web/src/components/agent/AgentFloat.tsx` 约 914 行，混合 HoverTip、AgentPanel、多个 timer/ref、世代计数、缓存与节流。该组件的修改回归成本高。

**建议**：保持现有视觉契约不变，拆成 `HoverTip`、`AgentPanel` 与 `useHoverTip`/`useHoverThrottle`；先补行为测试，再分步迁移。

### ARC-03 — Medium：SSE 与 Provider URL 解析存在重复实现

两个 Agent SSE 路由重复流控；Anthropic/OpenAI adapters 各有相近 base URL 拼接逻辑。重复实现会让超时、重定向、错误处理逐渐分叉。

**建议**：提取小型、纯函数 helper；不要借此引入大型框架或泛化 repository 层。

### ARC-04 — Medium：前后端契约存在重复声明与宽类型

`packages/shared` 已有部分共享 DTO/Principal/格式联合，但前端仍出现手写 principal、`Record<string, unknown>`，API LLM format 也在多个位置声明。扩展字段时容易只改一处。

**建议**：优先把公共请求/响应/枚举收敛到 shared；运行时仍由 Zod 做 API 边界校验，类型共享不能替代运行时校验。

### ARC-05 — Observation：CRUD fat-handler 当前可接受

articles 等路由已经达到数百行，但在当前实体规模与变更频率下，完整 controller/service/repository 三层可能增加样板。应以重复业务规则、事务边界与跨路由复用为抽取触发条件，而非单纯按行数重构。

### ARC-06 — Observation：扩展点设计良好

- Provider：adapter + `ApiFormat` 注册。
- Tool：registry + schema + execute 白名单。
- Permission：shared matrix + `can()`。
- Animation：shared template union + web registry。

这些扩展点清晰，但某些映射需在 shared 与 web 双端同步，建议未来生成或集中描述元数据。

---

## 5. 前端现代化、性能与可恢复性

### WEB-01 — High：未做路由级代码分割

`apps/web/src/app/router.tsx` 静态导入约 20 个页面。此次构建实际输出：`index-DD9BpZsk.js` **542.31 kB（gzip 166.55 kB）**，Vite 给出超过 500 kB 的 chunk warning。

**建议**：普通首页/文章页与 author/admin/settings 页面使用动态 import；用 Suspense 提供稳定骨架，按实测 bundle 结果设预算。

### WEB-02 — High：缺少全局 ErrorBoundary

未发现 `ErrorBoundary`/`componentDidCatch`。任一渲染异常可能导致整棵 React 树白屏，用户缺少恢复路径。

**建议**：在路由/AppShell 顶层增加可观测、可刷新、可返回安全页面的边界；避免在边界里回显异常堆栈。

### WEB-03 — Medium：受保护页面守卫重复

多个页面自行读取 `useAuth` 后判断 loading/role/admin。重复逻辑提高行为不一致风险，也使路由级数据预取与错误处理困难。

**建议**：抽 `RequireAuth`/`RequireRole`；明确 loading、unauthorized、forbidden 三种状态。

### WEB-04 — Medium：React Fast Refresh 与 Hooks lint warning

`npm run lint` 通过但产生 8 条 warning，包含 `useAuth.tsx`、`useTheme.tsx` 导出非组件、`AgentFloat.tsx` 复杂/缺失依赖、Markdown/正则无用转义等。warning 不阻断 CI，但长期会掩盖真实问题。

**建议**：将常量/Context hook 拆文件或配置规则边界；修正 hook 依赖；把 lint warning 纳入质量门槛或明确例外清单。

### WEB-05 — Medium：前端测试与 E2E 缺失

当前测试集中在 API/shared；未见前端 Vitest/jsdom 或完整 Playwright 流程。悬停交互、token refresh、Markdown 渲染、角色页面主要依赖手工验证。

**建议**：先为纯逻辑 hook/cache/session 添加单测，再建立注册→登录→内容→Agent 的最小 E2E。

---

## 6. 代码质量、复用与维护性

### Q-01 — High：路由集成测试薄弱

API 现有测试文件约 10 个、104 个测试通过，但主要覆盖 JWT、BYOK、Provider、Tool Loop、ACL、SSE 与缓存。articles/domains/topics/annotations/applications/animations/settings 等 CRUD 路由缺少 supertest 级集成测试，权限矩阵端到端边界未被完整锁定。

**建议**：优先补 reader/author/admin 的正反向用例、对象所有权、草稿可见性、审批提权与 refresh 旋转；使用隔离数据库与固定 seed。

### Q-02 — Medium：CI 没有执行 lint、audit、覆盖率门槛

`.github/workflows/ci.yml` 执行 npm ci、shared build、API/shared tests、web build、API build；未执行根 lint、`npm audit` 或 coverage threshold。根脚本虽有 `lint`，但 CI 未调用。

**建议**：增设 lint 与高严重度依赖审计；coverage 先报告再设门槛，避免无准备地阻断历史分支。

### Q-03 — Medium：错误/JSON 容错与 URL 解析有可抽取重复

多个 adapter 自己做相似 JSON fallback 与 URL 拼接；路由两处复制流控模板。重复的风险不在行数本身，而在安全策略修复可能漏改某一实现。

### Q-04 — Medium：日志/可观测性缺少聚合指标

Pino、requestId、LLM/cache/tool 事件已存在，但未发现 Prometheus/OpenTelemetry metrics/trace 导出。无法直接看 provider 失败率、缓存命中率、tool-loop 迭代分布和用户成本。

**建议**：先定义指标名称和 cardinality，再选实现；不要将原始 prompt、token、密钥写入 metrics。

### Q-05 — Medium：无 graceful shutdown

`apps/api/src/index.ts` 启动监听后未看到 SIGTERM/SIGINT 处理。容器/进程重启时 Prisma 连接、正在发送的 SSE 与正在进行的 Provider 请求缺少统一 drain 策略。

**建议**：停止接收新请求、等待有限时间、abort 活跃流、断开 Prisma，超时后退出。

### Q-06 — Low：状态/角色大量使用 String/JSON 字符串

Prisma schema 对 role/status 与部分 JSON 字段没有数据库层 enum/结构约束。当前应用层 schema 能控制主要写入点，但跨功能演进容易出现漂移。

**建议**：按兼容性分阶段收紧：先集中 domain schema/DTO，再评估迁移为 enum/Json 类型。

### Q-07 — Low：单进程内存状态限制水平扩展

会话清理节流、浏览量去重、卡片锁、L1/L2 cache 等部分使用模块级 Map/变量。多实例时行为不一致；部分文档已承认此取舍。

**建议**：当进入多实例部署再迁移到 Redis/共享 cache/数据库原子操作，并先定义一致性需求。

### Q-08 — Low：seed 使用 console 与若干魔法数/内联样式

seed CLI 仍有多处 `console.*`；前端 AgentFloat/AppShell 有大量内联 token 样式与计时常量。属于规范/维护问题，不是立即安全缺陷。

### Q-09 — Low：遗留与空壳目录增加认知成本

根 `api/` 为空；`_legacy/` 仍有 46 个 tracked 文件；`services/agent`、`services/mcp` 是仅 README 的预留目录；根 `tests/` 角色模糊。用户要求本次不修改，因此只登记为治理建议。

---

## 7. 文档、配置与部署审查

### DOC-01 — High：README CORS 端口描述漂移

`README.md:39` 仍描述默认端口为 5173；`apps/api/src/app.ts` 实际默认 CORS origin 为 `http://localhost:5280`。应以代码与 Vite 配置为准更新说明。

### DOC-02 — High：`.env.example` 的 VITE API URL 与代理约定不一致

`.env.example` 使用 `http://localhost:3001/api/v1`，而应用开发配置使用 `/api/v1` 走 Vite proxy。直连不一定必然失败，但会改变 CORS/部署语义，容易使新环境配置分叉。

### DOC-03 — High：架构文档对 `_legacy` 与 Annotation API 的描述过时

`docs/architecture/overview.md` 声称 `_legacy` 已被忽略、Annotation 尚无 API 路由；当前 git 与 `apps/api/src/routes/annotations.ts` 均显示相反事实。

### DOC-04 — Medium：部署交付链不完整

`docker-compose.yml` 只声明 PostgreSQL，没有 API/Web Dockerfile、迁移启动步骤或反向代理/静态托管定义。它适合开发数据库依赖，不是完整生产部署方案。`.npmrc` 中 `production=false` 还可能使生产安装保留 devDependencies，需由部署流程明确覆盖。

### DOC-05 — Medium：CI 触发与质量门槛不完整

CI 已覆盖 build/test，但无 lint、audit、coverage、concurrency 或 E2E。现有流水线可证明“当前编译与现有测试通过”，不能证明规范、安全依赖和关键业务流程完整。

---

## 8. 可执行路线图

### 0–2 天：安全止血与契约固化

1. 按 `docs/roadmap/httponly-cookie-migration.md` 迁移 refresh token 到 HttpOnly cookie，并加入 Origin/CSRF 策略。
2. 对 Tool Loop Observation 做不可信数据封装、长度限制、字段白名单与注入回归测试。
3. 为 JWT verify 显式设定算法白名单；拒绝已知占位 JWT/BYOK key。
4. 日志只记录 pathname，并加入 authorization/cookie/query redact。
5. 为 react/tool-loop 增加单独限流与用户级成本预算。

### 1–2 周：可恢复性、性能与审计

1. 路由代码分割 + Suspense；顶层 ErrorBoundary。
2. 统一 `RequireAuth`/`RequireRole`，补充权限边界集成测试。
3. 提权写入不可变审计事件。
4. 补 articles/settings/topics/annotations 等 supertest 集成测试。
5. 为 markdown/动画 JSON 设领域大小约束。
6. 增加 graceful shutdown 与活动 SSE drain。

### 2–4 周：结构与运营能力

1. 抽公共 SSE runner 与 Provider URL/JSON helpers。
2. 拆分 `AgentFloat.tsx`，保持现有视觉和交互契约。
3. 完善 `openai_responses` 真流式/能力元数据，或显式标注降级。
4. 建立指标：request latency、LLM outcome/usage、cache hit、tool iterations、auth failures。
5. 统一 shared DTO/Principal/format 类型，减少 `Record<string, unknown>`。
6. 明确 `_legacy`、根 `api/`、根 tests 与 services 占位目录的治理策略。

### 建议验收标准

- refresh 不可由常规前端 JS 读取；CSRF/Origin 负向测试通过。
- 恶意文章无法改变 Tool Loop 的系统级约束；Observation 长度、迭代、费用均受限。
- 首屏主 chunk 降至预算以内，渲染异常显示可恢复 UI。
- API 关键 CRUD/RBAC 集成测试覆盖率有可见报告，CI 运行 lint/audit。
- 生产关闭流程可在有限时间内 drain/abort；文档与当前端口、路由、遗留治理状态一致。

---

## 9. 验证结果

| 检查 | 结果 | 证据 |
|---|---|---|
| `npm test` | **通过** | API：10 个文件、104 tests；shared：1 个文件、4 tests |
| `npm run lint` | **通过但有 warning** | API 1 条；Web 8 条；无 error |
| `npm run build` | **通过** | shared、web、api 均成功；Vite 报主 chunk >500 kB warning |
| 源码规模统计 | 已核验 | `apps`/`packages` 下 177 个 TS/TSX 文件；11 个测试文件；`_legacy` 46 个 tracked 文件 |
| 动态安全/E2E | 未执行 | 未启动真实 DB/LLM/浏览器/生产部署 |

### lint warning 摘要

- `apps/api/src/lib/llm/tools/toolLoop.ts`：`hitMaxIters` 未使用。
- `apps/web/src/lib/markdown.ts`、`components/agent/hoverTarget.ts`：无用转义。
- `apps/web/src/hooks/useAuth.tsx`、`useTheme.tsx`：Fast Refresh 导出规则 warning。
- `apps/web/src/components/agent/AgentFloat.tsx`：复杂表达式依赖数组及 `hoverTip` 依赖 warning。

> 验证命令可能由工具链生成/更新构建缓存或工具目录；本次未主动编辑这些内容。最终工作区检查见交付摘要。

---

## 10. 审查边界与不应误报的取舍

1. **不要因为没有 repository 层就判定架构失败**：当前 CRUD 规模下 fat-handler 简洁且可读；当跨路由复用、事务或复杂策略增加时再抽取。
2. **不要把 prompt-based tool-loop 直接等同于 RCE**：它是提示词注入与成本放大风险，当前工具白名单/Zod/超时限制仍有效。
3. **SQLite 默认不是生产漏洞**：文档已经建议生产切 PostgreSQL；真正需要的是部署流程与迁移验证。
4. **内存 cache/lock 不是立即数据泄露**：它们是水平扩展一致性与容量问题，进入多实例前应明确迁移方案。
5. **lint warning 不是构建失败**：但 warning 已有真实 hook 依赖项，应及时清理或建立有理由的例外。

---

## 11. 最终判断

AgentForge 当前适合继续迭代，不建议进行一次性“大爆炸式”架构重写。最稳妥的路径是：先收紧浏览器会话与 LLM 不可信内容边界，再通过路由守卫、ErrorBoundary、代码分割和集成测试提升用户可恢复性与变更安全，随后抽取已重复的 SSE/Provider 小型基础设施，最后补齐部署与运营观测。这样可以在不破坏现有 Agent/动画体验、不改变前端视觉的前提下，逐步降低安全、维护与扩展成本。

**本报告只新增报告文件；未修改既有项目内容。**
