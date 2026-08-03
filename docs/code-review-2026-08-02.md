# AgentForge 代码质量审查报告(2026-08-02 复查)

> 审查日期:2026-08-02
> 范围:`apps/api/src`、`apps/web/src`、`packages/shared/src`、`apps/api/prisma/*`、根目录遗留静态代码、`docs/*`
> 方法:静态阅读 + 双子代理并行核查(测试/lint/遗留代码/其余页面),未修改任何代码
> 行号基准:master 分支 `9190914` 快照
> 严重度:🔴 严重(安全/正确性问题)/ 🟠 高(可靠性/可维护性)/ 🟡 中(代码气味)/ 🟢 低(建议性)

---

## 0. 审查摘要

| 维度 | 总评 | 关键风险 |
|------|------|----------|
| 代码质量 | 🟠 中等偏上 | 净化防御体系设计用心,但核心逻辑前后端双份实现且已漂移;`AgentFloat.tsx` 1200 行单体;部分页面请求无竞态防护 |
| 架构 | 🟡 良好 | 模块边界清晰;遗留静态站死代码仍在仓库;`PLAN.md` 与磁盘结构脱节 |
| 安全 | 🟠 中等偏上 | 鉴权/限流/Zod/DOMPurify/bcrypt 12 轮落实到位;但 `seed.ts` 存在提权风险、`trust proxy` 无条件信任、缓存清理接口无权限限制 |
| 验证体系 | 🔴 缺失 | 零自动化测试、无 CI;lint 仅 2 条规则;手工回归脚本是唯一防线 |

**总计 37 条发现(🔴 5 / 🟠 16 / 🟡 12 / 🟢 4)。**

### 与 2026-07-23 审查(`docs/code-review.md`)对比

| 上次问题 | 本次状态 |
|----------|----------|
| 悬停净化 bug-1~4(思考泄漏/规则复述) | ✅ 已加固(agentPrompt.ts 新增多级正则过滤、早停、极简重试;`test-hover-extract.ts` 回归脚本) |
| 缓存双层语义 | ✅ 已实现 L1(前端 20min/LRU64)+ L2(服务端 DB,2h/24h 热缓存) |
| `HOVER_REVEAL_MS = 2000` | ⚠️ 已改为 700ms,但帮助文案仍写"满 2 秒显示"(见 M-07) |
| 无单元测试 | ❌ 仍无(见 C-01) |
| 前后端净化逻辑双份实现 | ❌ 仍在,且已实际漂移(见 M-01) |
| `console.error` 残留 | ⚠️ 已减少,但无结构化日志体系(见 M-05) |

---

## 1. 🔴 严重问题(5 条)

### C-01 零自动化测试 + 无 CI 挂钩

- **位置**:全仓库;`tests/`(空目录)、`apps/api/scripts/test-hover-extract.ts`、`package.json`(无 test 脚本)
- **问题**:无任何 `*.test.*`/`*.spec.*` 文件,无 vitest/jest/playwright;根 `tests/unit`、`tests/integration` 是空目录;唯一"测试"是 117 行手工脚本,13 个硬编码 case,`process.exit(1)` 判失败,无框架、无 CI。
- **影响**:本项目最复杂、bug 历史最集中的部分(agentPrompt.ts 约 500 行正则净化、SSE 流控、双层缓存一致性)没有任何自动化防线;`docs/code-review.md` 自评测试完成度 20%,本次复查无改善。每次改正则只能靠手动回归,极易引入回归。
- **建议**:引入 vitest,优先覆盖纯函数:`extractHoverAnswer / isCompleteHoverAnswer / isSafeHoverPublicAnswer / finalizeHoverCardText / cleanDraftPart`(现有 `test-hover-extract.ts` 的 13 个 case 可平移为正式用例);其次补 `hoverCacheKey`、`ensureConversation` 访问控制、`resolveProvider` 分支;CI 至少跑 `tsc --noEmit` + vitest。

### C-02 seed.ts 超级管理员提权风险(已验证)

- **位置**:`apps/api/prisma/seed.ts:68-69`(硬编码密码)、`seed.ts:76-81`(upsert 提权)
- **问题**:
  1. 兜底密码 `ChangeMe_Admin_123!` 硬编码在仓库中,`SEED_ADMIN_PASSWORD` 未配置时即以**公开已知口令**创建 adminLevel=100 超级管理员;
  2. upsert 的 update 分支把"邮箱匹配到的任意已有用户"直接升级为 `role:'admin' + adminLevel:100`,不校验该账号是否已存在、是否本人——若攻击者先注册 `admin@agentforge.local`,再等 seed 运行,即完成无密码提权。
- **影响**:生产环境误跑 seed 即被接管;即使仅开发环境,也是明显的权限设计缺陷。
- **建议**:兜底密码改为"缺失即拒绝创建并报错退出";upsert 提权改为"仅当目标用户不存在时创建;已存在则只打印告警不升级",或要求显式 `SEED_FORCE_ADMIN=1` 环境变量。

### C-03 `/chat/stream` 缺少客户端断开时的上游 abort

- **位置**:`apps/api/src/routes/agent.ts:753-864`(`/chat/stream`),对比 `agent.ts:558-562`(`/explain/stream` 有 `req.on('close', () => llmAbort.abort())`)
- **问题**:`/explain/stream` 在客户端断开时通过 AbortController 取消上游 LLM;`/chat/stream` 只检查 `res.writableEnded` 后 `return`,**没有 abort 上游 fetch**。用户关页/断网后,上游继续生成到 maxTokens(deep 模式 2048)。
- **影响**:token 成本与时间浪费;多人断线场景下 API 侧并发悬挂连接堆积。
- **建议**:与 explain/stream 对齐,给 chat/stream 加 AbortController + `req.on('close')` 联动,并把 `signal` 传入 `streamLlm`。

### C-04 vite 代理端口与 API 默认端口不一致

- **位置**:`apps/web/vite.config.ts:25`(`target: 'http://127.0.0.1:3002'`)vs `apps/api/src/index.ts:4`(`PORT || 3001`)vs `.env.example:2`(`PORT=3001`)
- **问题**:仓库默认配置下(当前磁盘无 `.env`),dev 环境前端 `/api` 请求经代理打到 3002,API 实际监听 3001,全部落空;只有用户本地 `.env` 恰好设 `PORT=3002` 才一致——这是典型的"配置碎片化"陷阱,换机器必踩。
- **影响**:新环境开箱即"接口全挂",排查成本高。
- **建议**:统一为 3001(与 `.env.example` 一致),或代理改读环境变量;在 README 的 dev 启动说明中固定两者。

### C-05 ArticlePage 无条件覆盖学习进度(已验证)

- **位置**:`apps/web/src/pages/ArticlePage.tsx:49-51`
- **问题**:只要登录并打开文章,就无条件 `api.agentProgress({ articleSlug: slug, progress: 0.4, mastery: 'learning' })`——无滚动深度/停留时长/阅读完成判定,且 `progress: 0.4` 是固定值。
- **影响**:进度**回退**:已读到 0.9 的用户重开文章被覆盖回 0.4;`learningProgress` 数据被污染,进而污染 `loadUserContext` 生成的 memoryBlock("已掌握/学习中"判断失真)与 `mastered:` 记忆。
- **建议**:只有 `progress > 当前值` 时才上报(前端先 GET 或后端 upsert 用 `max` 语义);或按滚动比例动态计算;至少加"仅首次打开且未标记掌握"守卫。

---

## 2. 🟠 高优先级问题(16 条)

### M-01 前后端净化逻辑双份实现,已实际漂移

- **位置**:`apps/web/src/lib/hoverExplainCache.ts`(约 200 行)vs `apps/api/src/lib/llm/agentPrompt.ts`
- **问题**:`SELF_REVISION / SELF_TALK_PHRASE / SYSTEM_ECHO / TASK_ECHO / PLANNING / isSelfTalkSentence / cleanDraftPart / stripSelfRevision / looksLikePlanning / isLikelyHoverTeaching` 等前后端各实现一份,注释自述"与后端对齐"但无机制保证。逐项对比已发现漂移:
  - 前端 `TASK_ECHO` 缺:`只写\s*2`、`请用\s*2`、`知识点[，,].{0,8}要`、`完整话[，,].*结尾`(后端有);
  - 前端 `SELF_REVISION` 多出:`讲核心|讲边界|讲接口|用户说|1\s*个类比|一个类比|要自然|没有多余`(后端无)。
- **影响**:同一 LLM 输出,两端缓存判定结论可能相反(L1 拒而 L2 收,或反之);脏数据仍可能从前端缺口漏过;未来每加一条规则要改两处,必然继续漂移。
- **建议**:把净化规则下沉到 `packages/shared/src/sanitize.ts`,前后端共用同一份正则与函数;或用 vitest 对两端输出做一致性快照测试。

### M-02 `trust proxy` 无条件信任

- **位置**:`apps/api/src/app.ts:19`
- **问题**:`app.set('trust proxy', 1)` 硬编码,未按部署形态配置。
- **影响**:服务直接暴露(无反向代理)时,攻击者可伪造 `X-Forwarded-For` 头,令 express-rate-limit 的 IP 计数失准,**绕过限流**;误信代理链还会放大真实客户端 IP 解析问题。
- **建议**:`app.set('trust proxy', process.env.TRUST_PROXY === '1')` 或按部署文档固定;反向代理场景应同时配置 `app.set('trust proxy', 1)` 的前置说明。

### M-03 `/agent/cache/clear` 无权限限制

- **位置**:`apps/api/src/routes/agent.ts:355`(`requireAuth` 仅要求登录)
- **问题**:任意注册用户可调用,`deleteMany({})` 清空全表悬停缓存。
- **影响**:低成本成本攻击面——清空后全站重新打 LLM;且该接口同时影响所有用户(缓存是共享的)。
- **建议**:限制为 `requireRole('admin')` 或至少加冷却 + 操作审计日志。

### M-04 匿名数据无清理策略

- **位置**:`apps/api/src/routes/agent.ts:156-170`(`ensureConversation`)、`agent.ts:301-317`(`rememberTopic`)
- **问题**:匿名用户每次 chat 都会新建 `agentConversation`(即使 401 级游客),`agentMessage` 随对话增长;`rememberTopic` 虽仅登录用户,但 `seen:` 记忆无条数上限之外的去重。
- **影响**:SQLite 单文件库下,会话/消息表随使用无限膨胀,无 TTL、无清理任务。
- **建议**:匿名会话加 TTL(如 7 天)或上限;`agentConversation` 加 `expiresAt` 列 + 定时清理脚本;`seen:` 记忆按 key 前缀截断。

### M-05 后端无可观测性,写库大量 fire-and-forget

- **位置**:全后端;典型:`agent.ts:140-142`(缓存 hits 增量)、`agent.ts:487/644`(`void setHoverCache`)、`agent.ts:489`(`void rememberTopic`)、`articles.ts:144-149`(viewCount 增量);日志仅 `errorHandler.ts:46` 一处 `console.error` + `index.ts` 启动行
- **问题**:LLM 调用失败率、缓存命中率、早停次数、重试次数、abort 情况全部无日志;`void` 异步写库失败静默,出错无法发现。
- **影响**:生产排障只能靠猜;缓存/记忆写失败会造成"这次讲了一遍、下次又讲一遍"的隐性成本。
- **建议**:引入 pino 等结构化日志,LLM 调用/缓存命中等关键路径打点;fire-and-forget 写库 `.catch` 内至少 `logger.warn`。

### M-06 AgentFloat.tsx 1200 行单体组件

- **位置**:`apps/web/src/components/agent/AgentFloat.tsx`(1198 行)
- **问题**:一个组件同时承载:全局 hover 引擎(目标识别/防扫射/冷却窗口/双 rAF 动画)、SSE 流管理、缓存读写、聊天面板、deep explain、帮助面板;`deepExplain` 与 `send`(791-955 行)结构几乎相同;大量内联样式;hover effect 依赖 `[location.pathname, style]`,路由切换导致整个 document 级监听器重挂。
- **影响**:任何 hover 行为改动都在这一个文件里,`useRef` 状态机(gen/session/inflight)极难推演;两个流式函数改动要同步两处。
- **建议**:拆为 `useHoverEngine`(含 session 状态机)、`useAgentChat`(deepExplain/send 共用流式模板)、`AgentPanel` 展示组件。

### M-07 帮助文案与实现不一致

- **位置**:`apps/web/src/components/agent/AgentFloat.tsx:1045`("满 2 秒显示")vs `AgentFloat.tsx:103`(`HOVER_REVEAL_MS = 700`)
- **问题**:用户可见帮助文案与实际行为不符(700ms vs 宣称 2s)。
- **影响**:轻微误导用户;同时是"常量散落 + 文案硬编码"的例证(同组件 Q-13 魔法数)。
- **建议**:文案与常量同源(如从常量生成)或至少手动同步。

### M-08 `api.ts` 的 `request()` 无超时

- **位置**:`apps/web/src/lib/api.ts:27-45`
- **问题**:普通 API 调用无 abort/timeout(`agentStream.ts` 有 28s 超时,`api.ts` 没有);`res.json()` 对空响应体也会调用(靠 catch 兜底)。
- **影响**:慢网络/挂起连接下,页面请求无限挂起,loading 状态永不结束。
- **建议**:统一封装带 `AbortSignal.timeout()` 的请求层,超时后抛 `ApiError(408)`。

### M-09 文章阅读量每次 GET 详情都 +1 且无防刷

- **位置**:`apps/api/src/routes/articles.ts:144-149`
- **问题**:`GET /articles/:slug` 即 `viewCount { increment: 1 }`,作者本人、频繁刷新、爬虫都计入;fire-and-forget 无失败处理。
- **影响**:`popular` 排序(articles.ts:97-99)可被脚本刷榜;数据失真。
- **建议**:按会话/IP/用户去重(如 24h 内同一用户只计一次),或改由前端事件(滚动到 50%)上报。

### M-10 删除领域两步操作非事务

- **位置**:`apps/api/src/routes/domains.ts:203-204`
- **问题**:先 `updateMany` 解绑文章再 `delete`,未包事务。
- **影响**:中途失败留下"文章已解绑但领域仍存在"的中间态,且无重试机制。
- **建议**:用 `prisma.$transaction` 包裹;或靠 schema 的 `onDelete: SetNull` 让级联自动处理,只做单条 delete。

### M-11 作者申请无并发唯一约束(TOCTOU)

- **位置**:`apps/api/src/routes/applications.ts:36-41`;schema 无 `@@unique([userId, kind])`
- **问题**:pending 检查与 create 之间无约束兜底,并发双击可提交两份同类申请。
- **影响**:审核端出现重复申请,审核流程(approve 一单另一单悬挂)状态混乱。
- **建议**:schema 加 `@@unique([userId, kind])` + Prisma P2002 冲突映射(已有,errorHandler.ts:25-31)。

### M-12 动画 SVG id 重复定义

- **位置**:`apps/web/src/components/anim/primitives/SceneCanvas.tsx:57,94`(`id="ringGlow"` / `id="arrow"`)
- **问题**:每个 AnimationViewer 实例都输出相同 SVG `id`;一篇文章含多个动画时 DOM 内 id 冲突,`url(#arrow)` 等引用解析到第一个实例。
- **影响**:多动画文章(ArticleBody 支持 `:::animation` 嵌入)渲染错乱:箭头/光晕指向错误实例。
- **建议**:id 加实例唯一前缀(useId 或父组件传入的 animationId)。

### M-13 三个页面请求无竞态防护

- **位置**:`apps/web/src/pages/SearchPage.tsx:26-46`、`pages/LlmOverviewPage.tsx:20-25`、`pages/KnowledgeOverviewPage.tsx:26-34`
- **问题**:请求 effect 无 cancelled 标志(其他页面如 ArticlePage 有 `cancelled` 模式,这三个没有)。
- **影响**:快速切换搜索词/轨道/筛选时,旧响应后到覆盖新结果,展示与输入不一致。
- **建议**:统一加 `cancelled` 标志(项目内已有成熟模式可直接复制)。

### M-14 ArticleCardInlineAgent 展开锁潜在死锁(需确认)

- **位置**:`apps/web/src/components/article/ArticleCardInlineAgent.tsx:327-341`(配合 `lib/cardExpandLock.ts`)
- **问题**:卸载路径上若 `acquireExpand` 已 resolve 但后续微任务未执行,cleanup 只调 cancel/endCollapse,未置 `sessionOn=false`、未递增 gen;锁可能被"拿到后无人释放"。
- **影响**:后续所有卡片展开永久"思考中"(全局锁被占死);属竞态,偶发、难复现。
- **建议**:cleanup 中调用 `cancelExpandRequest(id)` 并保证 `endCollapse(id)` 幂等释放;给 acquireExpand 加超时兜底。

### M-15 API 侧 tsconfig 未启用未用变量检查

- **位置**:`apps/api/tsconfig.json`(无 `noUnusedLocals/noUnusedParameters`;`apps/web/tsconfig.app.json:17-19` 已启用)
- **问题**:API 侧未使用变量/参数不会被 tsc 拦截。
- **影响**:死代码与误写变量名在编译期漏过,本次审查即在 `buildScene.ts` 发现多处死代码(`doneNodeIds` 先算后覆盖、恒空展开等)。
- **建议**:API tsconfig 补 `noUnusedLocals: true`、`noUnusedParameters: true`。

### M-16 lint 形同虚设

- **位置**:`apps/web/.oxlintrc.json`(仅 2 条规则;schema 为相对路径 `./node_modules/oxlint/configuration_schema.json`)
- **问题**:`npm run lint` 只检查 `react/rules-of-hooks`、`react/only-export-components`;换机器时相对路径 schema 解析可能失败;API 侧无 lint。
- **影响**:大量可静态发现的问题(未用变量、危险 API、hook 依赖)全部漏过。
- **建议**:补全 oxlint 默认规则集(oxc/ts/import),API 侧也接入;schema 路径改用包内绝对路径或删掉 `$schema`。

---

## 3. 🟡 中优先级问题(12 条)

### L-01 遗留静态站死代码仍被 git 跟踪

- **位置**:根目录 `index.html`、`shell.html`、`pages/`(30 个 html)、`scripts/`(8 个 js)、`styles/`、`components/`、`.claude/launch.json`;`.gitignore:13` 的 `_legacy` 从未生效
- **问题**:整站旧版(React 版之前)无人引用(`apps/web/src`、`apps/api/src` 中无任何引用),却仍被跟踪;`.claude/launch.json` 仍配置静态站启动。
- **影响**:仓库体积与认知负担;新人容易误改错版本;`_legacy` 规则误导(以为已迁移)。
- **建议**:整体移入 `_legacy/`(git mv)或删除;清理 `.claude/launch.json` 过期条目;根目录 4 张 bug 截图(bug-1~4.png)一并清理或归档。

### L-02 文档与磁盘结构脱节

- **位置**:`PLAN.md:46,53,57,62,76`(提到不存在的 `docker-compose.yml`、`apps/web/src/features/`、`src/types/`、`docs/content-guide.md`、`rbac/rateLimit/users` 路由);`docs/dev-progress.md:200` 与 `docs/code-review.md:65` 把根 `scripts/` 误记为 `tests/`
- **问题**:PLAN 是 7 月架构蓝图,实际演进后未同步;两处 docs 对遗留脚本位置描述错误。
- **影响**:按文档查找资源会扑空;文档可信度下降。
- **建议**:PLAN.md 标注"历史蓝图"并补充现状指针;修正 docs 中的目录描述。

### L-03 废弃 @types stub 依赖

- **位置**:`apps/web/package.json:20`(`@types/dompurify`)、`apps/api/package.json:23`(`@types/bcryptjs`)
- **问题**:两个包 3.x 已自带类型,`@types/*` 是官方废弃 stub,源码无独立使用。
- **影响**:纯噪音;`npm audit` 时多两个无意义条目。
- **建议**:删除。

### L-04 硬编码供应商信息与文案

- **位置**:`apps/web/src/pages/SettingsPage.tsx:29-34`(BYOK 默认值写死 `api.stepfun.com/step_plan`、`step-3.7-flash`)、`SceneCanvas.tsx:132`(RingCanvas 悬停文案硬编码"ReAct/Agent 循环",loop 模板也显示)
- **问题**:换供应商需改代码;通用组件文案与具体模板耦合。
- **建议**:默认值从 `/agent/providers` 返回的 `defaultId` 派生;文案改为参数化。

### L-05 topics 列表返回完整正文

- **位置**:`apps/api/src/routes/topics.ts:46-52` + `services/serialize.ts:107-117`
- **问题**:列表接口直接返回最长 8000 字 `body`,前端只截取 160 字展示。
- **影响**:带宽浪费;列表页打开即拉取全量正文。
- **建议**:列表 DTO 截断或省略 body,详情接口再返回全文。

### L-06 validate.ts 残留 eslint-disable 注释

- **位置**:`apps/api/src/middleware/validate.ts:15`(`// eslint-disable-next-line @typescript-eslint/no-explicit-any`)
- **问题**:项目已用 oxlint,注释指向不存在的 lint 工具;`(req as any)` 也确有类型丢失。
- **影响**:误导读者以为有 eslint;类型保护缺失。
- **建议**:删除注释;用 module augmentation 扩展 Request 类型替代 `any`。

### L-07 slugify 兜底用 `Date.now()`

- **位置**:`apps/api/src/services/serialize.ts:120-130`
- **问题**:slug 冲突时兜底 `Date.now()` 生成后缀,同一毫秒重复保存产生相同 slug(第二次撞唯一约束),且语义不可读。
- **影响**:偶发 409;URL 无意义。
- **建议**:用随机短串(如 `crypto.randomBytes(3).toString('hex')`)或递增计数器。

### L-08 seed 幂等性:deleteMany 重建动画关联

- **位置**:`apps/api/prisma/seed.ts:173-176`
- **问题**:每次 seed 先 `deleteMany` 再重建 `articleAnimation`,会抹掉用户后来手动关联的动画。
- **影响**:跑过 seed 的库,手动配置被静默重置。
- **建议**:按"仅补缺失"的语义 upsert,不删除用户数据。

### L-09 AppShell 内嵌样式与 `!important` 覆写

- **位置**:`apps/web/src/components/layout/AppShell.tsx:203-211,359-367`(内嵌 `<style>` 块 + 媒体查询 `!important`)
- **问题**:样式分散在组件内,与 global.css/tokens.css 双轨。
- **影响**:样式来源难追踪;`!important` 覆写易被后续改动破坏。
- **建议**:迁移到 global.css 或 CSS Modules。

### L-10 DomainDetailPage 魔法选择器

- **位置**:`apps/web/src/pages/DomainDetailPage.tsx:156-159`(`div[style*="repeat(4"]` 属性选择器 + 内联 style + `!important`)
- **问题**:依赖内联样式字符串内容做选择器,栅格数变化即失效。
- **影响**:脆弱,改布局(如 3 列)时静默失效。
- **建议**:给栅格容器加稳定类名,样式入全局 CSS。

### L-11 global.css 硬编码 hex 未抽 token

- **位置**:`apps/web/src/styles/global.css:261-263,522-524`(代码块配色 `#1e1b18/#d4cfc7`)、`:430`(`#fff`)
- **问题**:tokens.css 已有 CSS 变量体系,但部分颜色绕过变量硬编码。
- **影响**:深色/浅色主题切换时这些块不跟随。
- **建议**:替换为 `var(--...)`。

### L-12 其余小项

- `apps/web/src/components/article/ArticleLayout.tsx:20-21`:声明了 `articleId`、`isArticleAuthor` 但从未使用(死 props)。
- `apps/web/src/components/anim/core/buildScene.ts:93-96,103,139,385-387`:死代码(`doneNodeIds` 先算后覆盖、恒空展开、`buildTimelineScene` 纯转发)。
- `apps/web/src/pages/TopicsPage.tsx:205-207`:"加载中"与"话题不存在"合并为同一状态文案,错误不可区分。
- `apps/web/src/pages/AuthPages.tsx:82-83`:RegisterPage 缺 LoginPage 的网络错误分类(TypeError 直接显示原始信息)。
- `apps/web/src/components/domain/DomainSection.tsx:56-62`:请求失败被吞掉仅置空列表,无错误提示。

---

## 4. 🟢 低优先级建议(4 条)

### G-01 前后端缓存 key 语义割裂

- **位置**:`apps/web/src/lib/hoverExplainCache.ts:239-241`(明文 `style::topic`)vs `apps/api/src/routes/agent.ts:69-73`(sha256 `v7::style::norm`)
- **问题**:同是 hover 缓存 key,两端实现不同(有意为之),且版本号 `v7` 硬编码在注释/字符串里,升级需手动改。
- **影响**:两端 key 无法互查;缓存规则升级历史全在注释里。
- **建议**:版本号常量提取;注释补充 v1~v7 演进表,便于下次升级。

### G-02 前后端 TTL 策略差异无文档

- **位置**:`hoverExplainCache.ts:8`(L1 20min)vs `agent.ts:38-40`(L2 2h/24h)
- **问题**:双层 TTL 设计合理,但为何前端短于后端无文档说明;`/agent/cache/clear` 只清 L2,前端需另行 `clearAllHoverCaches`,调用方容易只清一半。
- **建议**:在 architecture.md 补双层缓存契约说明。

### G-03 `request()` 对空响应体调用 `res.json()`

- **位置**:`apps/web/src/lib/api.ts:36`
- **问题**:无 body 响应(204/空)也调用 `res.json()`,靠 catch 兜底成 `{}`。
- **影响**:无害但语义不明。
- **建议**:先判 `res.status === 204` 或 `content-length`。

### G-04 测试残留痕迹清理

- **位置**:`apps/api/scripts/test-hover-extract.ts:38`(case 名 `bug4-task-echo`,注释提到"2026-08 截图泄漏样例",引用的 bug 截图根目录未跟踪)
- **问题**:截图既未入库也未清理,回归脚本引用外部资源无出处。
- **建议**:把 4 张截图归档到 docs/assets 或删除,并在脚本注释中说明样例来源。

---

## 5. 做得好的地方(维持现状)

- **悬停净化多层防御**:服务端清洗 → 缓存质量门(`isCompleteHoverAnswer`)→ 早停(`probeEarlyAnswer`)→ 极简重试 → 前端兜底再过滤;"脏数据永不入库"原则执行彻底,注释详尽记录了 bug-1~4 的演进。
- **安全基线**:bcrypt 12 轮、JWT_SECRET 长度校验(运行时拒绝短密钥)、helmet、双 rate limit、DOMPurify 消毒(ADD_ATTR 白名单收口)、BYOK key 掩码返回、SSE 响应头设置。
- **权限模型**:`packages/shared/permissions.ts` 集中管理,各路由抽查未发现越权读写路径;`requireRole/requirePermission/requireAdminLevel` 使用到位。
- **错误分类**:AppError/Zod/Prisma(P2002/2003/2025)统一映射,API 错误格式一致(`{ error: { code, message } }`)。
- **类型纪律**:两包 `strict: true`,`tsc --noEmit` 实测零错误;API 契约类型集中在 `@agentforge/shared`。
- **细节处理**:SSE 流中 abort/早停/重连语义清晰;`param()` 兼容 Express 5 的 `string|string[]`;缓存写入前做安全质检。

---

## 6. 修复优先级路线图

| 阶段 | 事项 | 对应条目 |
|------|------|----------|
| P0(先做) | 修 seed 提权;chat/stream 补 abort;端口统一 | C-02 / C-03 / C-04 |
| P0 | 引入 vitest,平移 test-hover-extract 的 13 个 case 为正式用例 | C-01 |
| P1 | 净化规则下沉 shared 包;ArticlePage 进度守卫 | M-01 / C-05 |
| P1 | trust proxy 环境化;cache/clear 加权限;匿名数据 TTL | M-02 / M-03 / M-04 |
| P2 | 结构化日志;AgentFloat 拆分;页面竞态防护;SVG id 唯一化 | M-05 / M-06 / M-13 / M-12 |
| P3 | 死代码清理(静态站、buildScene);文档同步;lint 补全 | L-01 / L-02 / M-16 等 |
