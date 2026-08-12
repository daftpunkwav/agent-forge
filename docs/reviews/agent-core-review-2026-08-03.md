# AgentForge Agent 核心审查报告（2026-08-03）

> 审查日期：2026-08-03
> 审查范围：**Agent 核心**——后端 `apps/api/src/lib/llm/*`、`apps/api/src/routes/agent.ts`、`apps/api/src/middleware/*`、`apps/api/src/app.ts`、前端 `apps/web/src/components/agent/*`、`apps/web/src/lib/agentStream.ts`、`apps/web/src/lib/hoverExplainCache.ts`、`apps/web/src/lib/markdown.ts`、`packages/shared/src/*`、`apps/api/prisma/schema.prisma`（Agent 相关模型）
> 方法：逐文件静态阅读，未运行/修改任何代码
> 行号基准：master 分支 `67d2079`
> 严重度：🔴 严重（安全/正确性）｜🟠 高（可靠性/可维护性）｜🟡 中（代码气味）｜🟢 低（建议性）
> 用途：本文档供执行方按条目逐项修改，每条均含**位置**、**问题**、**影响**、**修改建议**（含可直接套用的代码/配置），力求无歧义。

---

## 0. 审查摘要

| 维度 | 总评 | 关键风险 |
|------|------|----------|
| 代码质量 | 🟠 中等偏上 | 净化体系已下沉 shared 且用心，但 `AgentFloat.tsx` 仍 1177 行单体；`providers.ts` 三种格式实现存在重复；同步/流式两套 hover/chat 逻辑大量重复 |
| 安全性 | 🟠 中等偏上 | 鉴权/限流/Zod/DOMPurify/bcrypt 落实到位；但 **LLM 错误信息回显上游 URL**（信息泄漏）、**同步 LLM 调用无超时**（DoS）、**BYOK apiKey 明文存数据库**、**JWT 无 refresh 且 7d 长时存 localStorage** |
| 规范性 | 🟡 良好 | 命名/注释/错误体一致；但 `agent.ts` 单文件 1024 行；魔法数散落；`Record<string, unknown>` 滥用削弱类型 |
| 拓展性 | 🟡 良好 | Provider 抽象支持 BYOK 与三种格式；但 **硬编码 maxTokens/temperature 双份维护**、**无 tool-loop 抽象**、`streamLlm` 对 responses 格式名不副实 |
| 维护性 | 🟠 中等偏上 | shared 下沉消除了净化双份；但 hover/chat 同步与流式逻辑四份重复、Provider 无缓存、错误处理分支爆炸 |
| 可观测性 | 🟡 良好 | pino + requestId 已就绪；但 **缓存命中率/早停/重试/Provider 失败率无指标** |

**总计 31 条发现（🔴 4 / 🟠 11 / 🟡 11 / 🟢 5）。**

### 与上一轮（2026-08-02）审查的关系

上一轮 37 条中的 P0/P1 已基本修复（见 `code-review-2026-08-02.md` 第 7 节修复记录）。本报告聚焦 **Agent 核心新增/遗留/回归** 问题，不重复已修复条目。上一轮标记 ⏸️ 的样式类（L-09/L-10/L-11）按要求不动，本次沿用。

---

## 1. 🔴 严重问题（4 条）

### A-01 LLM 错误信息回显上游 URL，泄漏内部部署

- **位置**：`apps/api/src/lib/llm/providers.ts:519`、`:591`、`:623`、`:265`、`:392`
  ```ts
  throw new Error(`LLM 调用失败 (${res.status}) @ ${url}: ${msg}`);
  throw new Error(`LLM 流式失败 (${res.status}) @ ${url}: ${raw.slice(0, 240)}`);
  ```
- **问题**：错误字符串拼接了完整的上游 `url`（如 `https://api.stepfun.com/step_plan/v1/messages`，BYOK 场景可能含私有网关地址）。该错误经 `agent.ts` 的 `llmError()` 包装成 `AppError(502, 'LLM_ERROR', msg)`，`errorHandler.ts:9-12` 直接把 `err.message` 回写到响应体 `{ error: { code, message } }` 返回给客户端。
- **影响**：
  1. **信息泄漏**：客户端可见服务端真实 baseUrl、Provider 路径，BYOK 私有网关场景更严重；
  2. **上游原始报文**也回显（`raw.slice(0, 240)` 可能含上游鉴权失败细节、内部 trace id）；
  3. 与 `docs/architecture/security.md`「BYOK 仅服务端、脱敏展示」「500 不暴露堆栈」的安全意图相悖。
- **修改建议**：
  - 在 `providers.ts` 内部捕获并构造**面向客户端的安全消息**，把 `url`/`raw` 放进日志而非错误体。统一改造方式：定义一个内部错误类型携带诊断字段，`llmError()` 只取 `messageForClient`。
  - 具体改法（执行方可直接套用）：
    ```ts
    // providers.ts 顶部新增
    export class LlmCallError extends Error {
      constructor(
        public readonly status: number,
        public readonly messageForClient: string,
        public readonly diagnostic: { url: string; raw: string },
      ) {
        super(messageForClient);
        this.name = 'LlmCallError';
      }
    }
    ```
    所有 `throw new Error(\`LLM 调用失败 (${res.status}) @ ${url}: ${msg}\`)` 改为：
    ```ts
    throw new LlmCallError(res.status, `模型调用失败（HTTP ${res.status}）`, { url, raw: raw.slice(0, 500) });
    ```
  - `agent.ts` 的 `llmError()` 改造为：
    ```ts
    function llmError(err: unknown): AppError {
      if (err instanceof LlmCallError) {
        logger.error({ err: err.diagnostic, status: err.status }, 'LLM call failed');
        // 5xx 视为上游问题给 502；4xx 中 400/422 已在内部重试，这里统一 502
        return new AppError(502, 'LLM_ERROR', err.messageForClient);
      }
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { raw: String(err) } }, 'LLM call failed');
      return new AppError(502, 'LLM_ERROR', '模型调用失败，请稍后重试');
    }
    ```
  - 流式 SSE 路径（`explain/stream`、`chat/stream`）中 `sseWrite(res, { type: 'error', message })` 的 `message` 同样只发安全消息（不要发 `url`/`raw`）。

### A-02 同步 LLM 调用无超时，上游挂起将拖垮连接

- **位置**：`apps/api/src/lib/llm/providers.ts` 全部 `fetch` 调用（`:213`、`:237`、`:380`、`:485`、`:568`、`:601`）
- **问题**：
  - 流式接口（`/explain/stream`、`/chat/stream`）的 `req.signal` 会传入 `streamLlm`，客户端断开时可取消上游；但 `callLlm`（同步 `/explain`、`/chat`、`/settings/test-llm`、hover retry）**完全不传 signal**，`fetch` 无任何超时。
  - 上游 LLM 网关慢响应或挂起（如 StepFun 排队、网关 504 长挂）时，Express 连接将无限期占用，直到上游自行断开或 Express 默认 socket timeout。
- **影响**：
  1. 同步 `/explain`、`/chat` 单请求可挂数分钟；
  2. `agentLimiter` 是 40 req/min，挂起连接累积即可耗尽连接池，造成对其他用户的拒绝服务；
  3. `retryHoverExplain`（`agent.ts:99-118`）也走 `callLlm`，失败重试同样无超时，放大挂起时长。
- **修改建议**：
  - 给 `callLlm`（非流式）统一加超时。在 `providers.ts` 内部用 `AbortSignal.timeout()` 包一层，超时后中断 fetch：
    ```ts
    // providers.ts 顶部常量
    const LLM_CALL_TIMEOUT_MS = 30_000; // 同步调用上限 30s；可按 mode 调整
    ```
    在 `callAnthropicMessages` / `callOpenAiChat` / `callOpenAiResponses` 的 `fetch(...)` 中合并传入 signal：
    ```ts
    const timeoutSignal = AbortSignal.timeout(LLM_CALL_TIMEOUT_MS);
    // 若调用方传了 req.signal，两者任一触发即中断
    const signal = req.signal
      ? AbortSignal.any([req.signal, timeoutSignal])
      : timeoutSignal;
    // fetch(..., { signal })
    ```
  - `retryHoverExplain` 的 `maxTokens: 220` 可用更短超时（如 12s），因为它是兜底重试。
  - 注意 Node 20+ 支持 `AbortSignal.timeout` 与 `AbortSignal.any`；若需兼容旧版本可用 `AbortController` + `setTimeout` 手动实现。
  - 超时应抛 `LlmCallError`（见 A-01），messageForClient 给「模型响应超时，请稍后重试」。

### A-03 BYOK apiKey 明文存于数据库 preferences JSON

- **位置**：`apps/api/src/routes/settings.ts:108-124`（`preferences.byok.apiKey` 明文写入 `User.preferences` JSON 字符串）；`schema.prisma:28`（`preferences String @default("{}")`）
- **问题**：用户的 BYOK `apiKey` 以明文存储在 SQLite 的 `preferences` 列中。`listPublicProviders` / `publicByok` 已做脱敏返回，但**存储层未加密**。
- **影响**：
  1. 数据库文件（`apps/api/prisma/dev.db`）泄漏即泄漏所有用户的第三方 LLM API Key；
  2. 备份/转储同样泄漏；
  3. `docs/architecture/security.md` 未提及密钥静态加密，属于未实现的待办，但 BYOK Key 是真实可变现的凭据，风险高于一般偏好。
- **修改建议**（按成本由低到高三选一，**推荐第一项作为最低限度**）：
  1. **应用层加密（最低限度）**：用 `JWT_SECRET` 或独立 `BYOK_ENCRYPTION_KEY`（≥32 字符）派生密钥，对 `byok.apiKey` 做 AES-256-GCM 对称加密后存库；读取时解密。`crypto.createCipheriv` 即可实现，密文 + iv + tag 一并存。读取路径：`loadUserContext`、`settings.ts` 的 `resolveProvider`。
  2. **不持久化，仅内存/会话**：BYOK Key 仅前端持有，每次请求随 `Authorization` 之外的自定义头传入，服务端不存。代价：刷新页面需重输，且前端需安全存储。
  3. **迁移到独立密钥管理**：如未来上 PostgreSQL，用 KMS / Vault。
  - 无论哪种，均应：在 `docs/architecture/security.md` 的「未实现」清单中把「BYOK 静态加密」标记为已完成或明确登记。

### A-04 面板 `/chat` 与 `/chat/stream` 缺少悬停那样的「安全质检」，深度讲解可能回显思考/规则

- **位置**：`apps/api/src/routes/agent.ts:767`、`:889`（chat 同步与流式均用 `extractVisibleAnswer`）；`apps/api/src/lib/llm/agentPrompt.ts:97-136`（`extractVisibleAnswer`）
- **问题**：
  - 悬停路径有 `extractHoverAnswer` + `isSafeHoverPublicAnswer` + retry 三重门控；但 **deep/chat 路径只调用 `extractVisibleAnswer`**，后者仅做「从 thinking 切出正文」的启发式拆分，**不做安全/完整性质检**。
  - `buildDeepSystem`（`agentPrompt.ts:69-91`）的 system prompt 含「禁止输出写作计划…」「### Thought」等格式指令；若模型把 system 规则复述进正文，`extractVisibleAnswer` 的 `PLANNING_HINT_LOCAL` 正则（`:139-140`）会尝试剥离，但其逻辑是「正文已有 Thought 标题或 >40 字就优先正文」，对「正文本身就复述了规则」的情况不拦截。
  - 流式 chat deep 模式（`agent.ts:864-878`）把 `thinking` chunk 原样 `sseWrite` 给客户端展示在「思考过程」折叠区——这本身是产品设计，但 `final.thinking` 来自 `extractVisibleAnswer(...).thinking`，可能包含 system 规则复述。
- **影响**：用户可见的「思考过程」或正文可能泄漏 system prompt 的硬性规则（如「禁止输出写作计划」本身），削弱 prompt 防御并暴露内部措辞。
- **修改建议**：
  - 对 deep/chat 的 `final.answer` 至少做 `!looksLikeHoverPlanning(answer)` 的轻量门控（复用 shared 的 `looksLikeHoverPlanning`）；命中时记录日志但不强制清空（深度讲解允许较长，不应误杀）。
  - 对 `final.thinking` 展示前做 `SYSTEM_ECHO` / `TASK_ECHO` 检测（shared 已导出 `looksLikeHoverPlanning`，可扩展导出一个 `looksLikeSystemEcho` 或直接复用）；命中规则复述的 thinking 片段不回传客户端（置空或打码）。
  - 在 `agentPrompt.ts` 的 `extractVisibleAnswer` 返回前增加一道过滤：若 `answer` 命中 `SYSTEM_ECHO`（需从 shared 导出），返回空 answer 触发上层兜底。
  - 执行方注意：此条改动需配合测试（见 A-05），避免误杀正常深度讲解。

### A-05 测试覆盖仅悬停净化，LLM Provider / 路由 / 缓存零测试

- **位置**：`apps/api/src/lib/llm/agentPrompt.hover.test.ts`（仅 11 例，全为净化函数）；`vitest.config.ts`
- **问题**：当前唯一测试文件只覆盖 `extractHoverAnswer` 等纯函数。Agent 核心最易出错的部分——`providers.ts` 的三种格式解析、URL 解析、`resolveProvider` 分支、`agent.ts` 的缓存命中/过期/质检删除、`ensureConversation` 访问控制、SSE 早停——**无任何自动化覆盖**。
- **影响**：上一轮 C-01 已引入 vitest，但覆盖面太窄；任何对 `providers.ts` 的改动（如本报告 A-01/A-02 的改造）无回归保护。
- **修改建议**：补齐以下测试（均可用 vitest，无需真实 LLM——用 `vi.spyOn(global, 'fetch')` mock）：
  1. `resolveAnthropicMessagesUrl` / `resolveOpenAiChatUrl` / `resolveOpenAiResponsesUrl` 的边界（`/v1` 结尾、已含 `/messages`、根路径、带尾斜杠）。
  2. `extractAnthropicParts`：content 数组含 text+thinking 块、`completion` 字符串、`output_text`、空。
  3. `loadProviders` / `byokToProvider` / `resolveProvider`：BYOK 优先、缺字段返回 null、enabled=false 跳过。
  4. `hoverCacheKey` 版本号隔离；`getHoverCache` 过期分支（mock 时间）、hits≥8 走 24h、脏数据删除。
  5. `ensureConversation`：登录用户不可访问他人会话、匿名不可访问有主会话、过期匿名会话新建。
  6. 至少一个 SSE 早停集成测试：mock `streamLlm` 生成 thinking 后给 text，断言 `llmAbort.abort()` 被调用、客户端只收到 `status` + `final`。

---

## 2. 🟠 高优先级问题（11 条）

### B-01 `AgentFloat.tsx` 仍为 1177 行单体，hover 引擎与聊天面板耦合

- **位置**：`apps/web/src/components/agent/AgentFloat.tsx`（1177 行）
- **问题**：一个组件同时承载：全局 hover 引擎（目标识别 / 防扫射 / 冷却窗口 / 双 rAF 动画 / session 状态机）、SSE 流管理、L1 缓存读写、聊天面板、deep explain、帮助面板。20+ 个 `useRef`，hover 主 effect（`:398-762`）单函数 364 行。
- **影响**：任何 hover 行为改动都在这 364 行里推演 `gen/session/inflight` 状态机；上一轮 M-06 抽取了 `runPanelStream`，但 hover 引擎仍内联。
- **修改建议**：进一步拆分（执行方可分步）：
  1. `useHoverEngine()` hook：封装 `sessionRef / genRef / inflightKeyRef / requestWindow / 所有 timer` 与 `startPrefetch / onOver / onOut / abortHoverWork`，返回 `{ hoverTip, tipBox, tipEntered }`。
  2. `AgentPanel.tsx`：聊天面板 UI（messages 列表 + input + 帮助），消费 `runPanelStream`。
  3. `AgentFloat.tsx` 仅做布局组合 + 挂载 `useHoverEngine` 与 `useAgentChat`。
  - 注意：hover effect 依赖 `[location.pathname, style]`，拆分后 hook 需以这两个为依赖；不要引入额外重挂。

### B-02 hover/chat 同步与流式逻辑四份重复

- **位置**：`apps/api/src/routes/agent.ts`
  - `/explain`（`:477-540`）与 `/explain/stream`（`:542-713`）的 `runExplain` + 缓存查询 + LLM 调用 + retry + `rememberTopic` 逻辑重复；
  - `/chat`（`:715-788`）与 `/chat/stream`（`:790-918`）的 system 组装 + history + `persistTurn` + `rememberTopic` + `maybeSaveImportantMemory` 重复。
- **问题**：四个 handler 各自拼装相同上下文，行为容易漂移（如 `/explain` 同步路径有 `retryHoverExplain` 但无早停；流式路径有早停 + retry）。
- **修改建议**：
  - 抽取 `prepareExplain(body, userId)`（已有 `runExplain`，可扩展返回缓存/早停辅助）与 `prepareChat(body, userId)`，同步/流式共用。
  - hover 同步路径补齐与流式一致的 retry 触发条件（当前两者 retry 触发点不同：同步在 `explanation===''` 时，流式在 `!answer` 时——语义一致但实现重复）。
  - 把 `persistTurn + rememberTopic + maybeSaveImportantMemory` 封装为 `finalizeChatTurn(convId, userId, userMsg, answer)`，chat 同步/流式共用。

### B-03 `loadProviders()` 每次调用重新读环境变量，无缓存

- **位置**：`apps/api/src/lib/llm/providers.ts:50-93`
- **问题**：`loadProviders()` 每次都 `process.env` 读取 + 构造数组 + filter。`getDefaultProvider()`、`listPublicProviders()`、`resolveProvider()` 都调用它，每次请求至少 1-2 次。
- **影响**：性能损耗小但无谓；更重要的是**环境变量热更新语义不明**（当前每次读最新值，但生产不会热更）。
- **修改建议**：模块级缓存，进程启动时加载一次：
  ```ts
  let _providers: ProviderConfig[] | null = null;
  export function loadProviders(): ProviderConfig[] {
    if (_providers) return _providers;
    // ... 现有构造逻辑 ...
    _providers = list.filter((p) => p.baseUrl && p.apiKey);
    return _providers;
  }
  ```
  若需支持测试重置，导出 `resetProviderCache()` 供测试用。

### B-04 `streamLlm` 对 `openai_responses` 格式名不副实

- **位置**：`apps/api/src/lib/llm/providers.ts:180-182`
  ```ts
  const full = await callOpenAiResponses(p, req);
  if (full.text) yield { kind: 'text' as const, text: full.text };
  ```
- **问题**：`streamLlm` 对 `anthropic_messages` 与 `openai_chat` 是真流式（逐 chunk yield），但对 `openai_responses` **退化为整段非流式调用**后一次性 yield。调用方（`streamLlm` 的所有使用者）以为拿到的是流，实际等到整个响应完成才收到第一个 chunk。
- **影响**：
  1. 选用 responses 格式的用户，悬停/面板「思考中」会一直转到最后才一次性出全文，体验断崖；
  2. 早停（`probeEarlyAnswer`）对 responses 格式无效——因为只有最后才有 text，无法中途 abort。
- **修改建议**（按成本由低到高）：
  1. **文档明确**：在 `docs/architecture/agent-modes.md` 与 `/meta` 接口标注 responses 格式不支持真流式，前端给用户提示。
  2. **实现真流式**：OpenAI Responses API 支持 `stream: true` + SSE（事件类型 `response.output_text.delta`），参照 `streamOpenAiChat` 实现 `streamOpenAiResponses`，逐 delta yield。
  - 推荐第二项；若短期不做，至少在 `streamLlm` 入口对 responses 格式打 warn 日志，便于排障。

### B-05 Provider fetch 无重试，单次 5xx/网络抖动直接失败

- **位置**：`providers.ts` 所有 `callXxx` / `streamXxx`
- **问题**：上游 LLM 网关偶发 502/503/网络抖动时直接抛错，无重试。`retryHoverExplain` 只在「空答案」时重试，不覆盖「调用失败」。
- **影响**：悬停讲解对上游瞬时故障零容忍；用户体感为频繁「讲解生成失败」。
- **修改建议**：
  - 对 `callLlm`（同步）增加有限重试：仅对 502/503/504/网络错误重试 1 次，带指数退避（如 500ms）；4xx 不重试（多为参数/鉴权问题）。
  - 流式路径在**首个 chunk 到达前**失败时可重试一次（已到达 chunk 则不重试，避免重复输出）。
  - 重试需配合 A-02 的超时，避免重试放大挂起。
  - 用 `LlmCallError` 区分可重试（5xx/网络）与不可重试（4xx），见 A-01。

### B-06 缓存命中率 / 早停 / 重试 / Provider 失败率无指标

- **位置**：全 `agent.ts`
- **问题**：pino 日志已就绪，但关键业务指标无结构化打点：缓存命中（`getHoverCache` 命中/过期/脏数据删除）、早停（`probeEarlyAnswer` 触发）、retry（`retryHoverExplain` 成功/失败）、Provider 失败率/延迟。当前只有 `logger.error`/`logger.warn` 文本日志。
- **影响**：生产无法回答「悬停缓存命中率多少」「早停省了多少 token」「哪个 Provider 失败率高」。
- **修改建议**：
  - 在关键路径增加结构化 `logger.info` 打点（带可枚举字段）：
    - `getHoverCache`：`{ event: 'hover_cache_hit' | 'hover_cache_miss' | 'hover_cache_expired' | 'hover_cache_dirty', key }`
    - 早停：`{ event: 'hover_early_stop', topic, chars }`
    - retry：`{ event: 'hover_retry_ok' | 'hover_retry_fail' }`
    - LLM 调用：`{ event: 'llm_call', providerId, format, mode, ms, ok }`
  - 可后续接入 Prometheus / 结构化日志聚合；现阶段先打字段即可。

### B-07 `ensureConversation` 每次建会话都触发全表清理扫描

- **位置**：`apps/api/src/routes/agent.ts:167-171`
  ```ts
  void purgeExpiredGuestConversations().catch(...)
  ```
- **问题**：`ensureConversation` 在 chat 同步与流式路径都被调用，每次都 `void purgeExpiredGuestConversations()`（`deleteMany where expiresAt < now`）。虽有 `@@index([expiresAt])`，但每次请求都扫一次属于浪费。
- **影响**：高并发 chat 下，每个请求触发一次清理扫描；SQLite 写锁竞争。
- **修改建议**：
  - 改为节流清理：模块级时间戳，每 N 分钟（如 10min）才执行一次：
    ```ts
    let lastPurgeAt = 0;
    const PURGE_INTERVAL_MS = 10 * 60 * 1000;
    async function maybePurgeGuestConversations() {
      const now = Date.now();
      if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
      lastPurgeAt = now;
      await purgeExpiredGuestConversations().catch((e) =>
        logger.warn({ err: String(e) }, 'guest conversation purge failed'),
      );
    }
    ```
    在 `ensureConversation` 中调用 `void maybePurgeGuestConversations()`。
  - 或改为定时任务（`setInterval`），但需考虑多进程部署的并发，节流方案更稳妥。

### B-08 `maybeSaveImportantMemory` 启发式过于简陋且无去重上限

- **位置**：`apps/api/src/routes/agent.ts:242-262`
  ```ts
  if (/请记住|记住：|我的偏好|以后.*用/.test(userMsg)) {
    const key = `pref:${userMsg.slice(0, 40)}`;
    ...
  }
  ```
- **问题**：
  1. 正则匹配「请记住」即写入，用户说「请记住这个是错的」也会存；
  2. key 用 `userMsg.slice(0, 40)`，不同消息产生不同 key，可无限增长；
  3. value 是 `userMsg -> answer` 拼接，语义不清。
- **影响**：`AgentMemory` 表被低质量条目污染；`loadUserContext` 读 40 条记忆注入 prompt，噪声增大。
- **修改建议**：
  - 短期：对 `pref:` 前缀记忆按用户做数量上限（如最多 20 条，超出按 `updatedAt` 淘汰最旧）。
  - 中期：用 LLM 做一次「是否值得记忆 + 提炼为结构化事实」的轻量抽取（小 maxTokens），而非原文存储。
  - 至少把 key 改为稳定哈希（如 `pref:${sha256(userMsg).slice(0,16)}`）避免同一消息重复写。

### B-09 `loadRecentMessages` 取 12 条但无 token 预算控制

- **位置**：`apps/api/src/routes/agent.ts:194-200`、`:725-729`、`:800-804`
  ```ts
  const recent = await loadRecentMessages(conv.id); // take 12
  const historyBlock = recent.reverse().map((m) => `${m.role}: ${m.content.slice(0, 400)}`).join('\n');
  ```
- **问题**：固定取 12 条，每条截 400 字，最多 4800 字历史 + memoryBlock + system 规则，总 prompt 可能超 6k 字。对 `fast` 模式（maxTokens 500）而言，输入远大于输出，成本与延迟不利；且无 token 计数，长会话可能撑爆模型上下文窗口。
- **修改建议**：
  - 引入粗略 token 估算（中文按 1.5 字/token，英文按 0.25 词/token），设定历史 token 预算（如 deep 2000 / fast 600），从最新向前累加直到预算用尽。
  - 或至少按 mode 调整 take：fast 取 6 条、deep 取 12 条。
  - `conv.summary` 已有滚动摘要，应优先用 summary + 最近少量消息，而非固定 12 条全文。

### B-10 SSE 错误处理路径中 `res.end()` 可能重复调用

- **位置**：`apps/api/src/routes/agent.ts:708`、`:914`
  ```ts
  } catch (e) { ... sseWrite(res, { type: 'error', ... }); }
  res.end();  // 可能 res.writableEnded 已 true
  ```
- **问题**：内层 catch 写 error 后，外层 `res.end()` 无条件调用；若中途 `res.destroyed` 或已 end，`res.end()` 会抛或被忽略（Express 5 行为）。
- **修改建议**：统一在 finally 中保护：
  ```ts
  } finally {
    if (!res.writableEnded) {
      try { res.end(); } catch { /* 已关闭 */ }
    }
  }
  ```
  并在写 error 前判 `!res.writableEnded && !res.destroyed`。

### B-11 前端 L1 缓存 `incompleteKeys` 永不清理，长期增长

- **位置**：`apps/web/src/components/agent/AgentFloat.tsx:65`（`incompleteKeys = useRef<Set<string>>(new Set())`）
- **问题**：`incompleteKeys` 只在缓存清除事件（`:142`）时清空，正常使用中只 `add` 不 `delete`（`pushCache` 时 delete，但失败/中断的 key 会一直留着）。长时间浏览会累积大量「禁止读半截」的 key。
- **影响**：内存缓慢增长；某些 key 因一次中断被永久标记 incomplete，后续永不命中缓存（即使后端 L2 已有完整答案）。
- **修改建议**：
  - 给 `incompleteKeys` 加 TTL 或大小上限：超过 200 条时清最旧；或每条带时间戳，5 分钟后自动允许重试。
  - 更合理：incomplete 标记应有时效——后端 L2 可能已补全，前端不应永久拒绝。改为「本次会话内 incomplete」，页面刷新即清。

---

## 3. 🟡 中优先级问题（11 条）

### C-01 `Record<string, unknown>` 滥用削弱类型安全

- **位置**：`providers.ts:192`（`body: Record<string, unknown>`）、`:472`、`:497`（`data: Record<string, unknown>`）、`agentPrompt.ts:102` 等
- **问题**：LLM 请求体与响应体大量用 `Record<string, unknown>`，访问字段靠 `as` 断言（如 `:530` `(data.usage as { input_tokens?: number })`），类型保护形同虚设。
- **修改建议**：为 Anthropic / OpenAI 的请求体与响应体定义 interface（至少覆盖用到的字段），`buildAnthropicBody` 返回具体类型；`extractAnthropicParts` 参数用具体响应类型。

### C-02 `agent.ts` 单文件 1024 行，路由 + 业务逻辑 + 缓存 + SSE 混杂

- **位置**：`apps/api/src/routes/agent.ts`
- **问题**：路由定义、缓存逻辑（`getHoverCache/setHoverCache`）、会话管理（`ensureConversation/persistTurn`）、记忆（`loadUserContext/rememberTopic/maybeSaveImportantMemory`）、SSE 工具（`initSse/sseWrite`）、LLM 调用编排全部在一个文件。
- **修改建议**：拆分为：
  - `routes/agent.ts`：仅路由定义与 handler 骨架
  - `services/hoverCache.ts`：`getHoverCache/setHoverCache/hoverCacheKey`
  - `services/agentConversation.ts`：`ensureConversation/loadRecentMessages/persistTurn`
  - `services/agentMemory.ts`：`loadUserContext/rememberTopic/maybeSaveImportantMemory`
  - `lib/sse.ts`：`initSse/sseWrite/softStreamHoverAnswer`

### C-03 魔法数散落，maxTokens/temperature 三处各不同

- **位置**：
  - `providers.ts:190`（anthropic stream fast=900/deep=2048）
  - `providers.ts:235`（anthropic stream fallback fast=220）
  - `providers.ts:372`（openai chat stream fast=512/deep=1600）
  - `providers.ts:468`（anthropic sync fast=900/deep=2048）
  - `providers.ts:577`（openai chat sync fast=256/deep=1024）
  - `providers.ts:610`（openai responses fast=256/deep=1024）
  - `agent.ts:504`（explain hover=220/deep=2048）、`:629`（stream hover=220/deep=2048）、`:755`（chat fast=700/deep=2048）、`:850`（chat stream fast=500/deep=2048）
- **问题**：同一「fast/deep」语义在不同 provider/接口下 maxTokens 取值不一致（fast 在 anthropic stream=900，openai chat stream=512，openai chat sync=256，explain=220），无统一来源；temperature 同理（0.15/0.25/0.3/0.55/0.6 散落）。
- **修改建议**：集中到 `llm/config.ts`：
  ```ts
  export const LLM_TOKEN_LIMITS = {
    hover: { maxTokens: 220, temperature: 0.15 },
    chatFast: { maxTokens: 600, temperature: 0.3 },
    chatDeep: { maxTokens: 2048, temperature: 0.55 },
    clickDeep: { maxTokens: 2048, temperature: 0.55 },
  } as const;
  ```
  providers 与 agent 统一引用；mode 到具体参数的映射在调用方完成，providers 不再按 mode 猜测。

### C-04 `extractVisibleAnswer` 的 `PLANNING_HINT_LOCAL` 与 shared 重复

- **位置**：`apps/api/src/lib/llm/agentPrompt.ts:139-140`
  ```ts
  const PLANNING_HINT_LOCAL = /(?:^|[。！？\n])我需要[:：]|...|判断用户/;
  ```
  与 `packages/shared/src/hoverSanitize.ts:20-21` 的 `PLANNING_HINT` 几乎相同但**注释自述「避免循环依赖」故意不 import**。
- **问题**：shared 已导出 `looksLikeHoverPlanning`（内部用 `PLANNING_HINT`），`agentPrompt.ts` 却维护一份本地副本，正是上一轮 M-01 想消除的「双份漂移」残余。
- **修改建议**：删除 `PLANNING_HINT_LOCAL`，`extractVisibleAnswer` 内改用 shared 的 `looksLikeHoverPlanning`（它已覆盖这些模式且更全）。循环依赖是误判——`agentPrompt.ts` 已从 shared re-export 多个函数，不存在循环。

### C-05 `callOpenAiResponses` 把多轮对话压成单行 input

- **位置**：`providers.ts:599`
  ```ts
  const input = req.messages.map((m) => `${m.role}: ${m.content}`).join('\n');
  ```
- **问题**：OpenAI Responses API 的 `input` 本可接受结构化消息数组，这里压成 `role: content` 纯文本字符串，丢失角色语义，模型可能混淆 system/user/assistant。
- **修改建议**：传结构化 `input`（Responses API 支持 `[{role, content}]` 形式），与 `callOpenAiChat` 对齐。

### C-06 `parsePrefs` 在 `agent.ts` 与 `settings.ts` 各定义一份

- **位置**：`agent.ts:264-270`、`settings.ts:23-29`
- **问题**：两处完全相同的 `parsePrefs` 函数。
- **修改建议**：抽到 `lib/prefs.ts` 统一导出。

### C-07 `hoverCacheKey` 前后端实现不同但无文档说明意图

- **位置**：`agent.ts:74-77`（sha256 + 版本号）、`hoverExplainCache.ts:50-52`（明文 `style::topic`）
- **问题**：两端 key 不同（后端 hash 入库，前端明文内存），上一轮 G-01 已记录。虽是有意为之（后端需防 key 可读、前端需快速比较），但无注释说明。
- **修改建议**：在两处函数上方加注释说明「前端 key 不需与后端一致，因 L1/L2 独立查询」；后端 key 的版本号演进已有注释（`agent.ts:69-72`），前端补一句「L1 不版本化，随 L2 升级自然失效」。

### C-08 `softStreamHoverAnswer` 按句分割正则不匹配问号与省略号

- **位置**：`agent.ts:81-82`
  ```ts
  const pieces = answer.match(/[^。！]*[。！]/g)?.filter(...) || [answer];
  ```
- **问题**：只按 `。！` 分句，若答案含 `？` 或 `…`（虽 `isSafeHoverPublicAnswer` 拒绝问号，但省略号可能漏过），分句会粘连。
- **修改建议**：由于 `isSafeHoverPublicAnswer` 已保证无 `？`，当前基本安全；但为稳健起见，分句正则补 `？…`：`/[^。！？…]*/`。低优先。

### C-09 前端 `agentStream.ts` 超时后不区分「上游慢」与「主动取消」

- **位置**：`agentStream.ts:95-99`
  ```ts
  if (e.name === 'AbortError') {
    if (signal?.aborted) throw e;  // 主动取消
    throw new Error('讲解超时，请再悬停试一次');  // 超时
  }
  ```
- **问题**：超时与主动取消都走 `AbortError`，靠 `signal?.aborted` 区分；但若调用方在超时同一时刻主动 abort，判断可能不准。
- **修改建议**：用独立标志位 `timedOut` 在 `setTimeout` 回调中置 true，catch 中优先判断 `timedOut`。

### C-10 `ArticleCardInlineAgent` 与 `AgentFloat` 的 hover 流式处理逻辑重复

- **位置**：`ArticleCardInlineAgent.tsx:262-300`（streamBuf 累加 + looksLikeHoverPlanning + 按句截断展示）与 `AgentFloat.tsx:533-560`
- **问题**：两处对 SSE delta 的「旁白检测 + 按句截断 + 安全门控」逻辑几乎相同，是前端版的「双份实现」。
- **修改建议**：抽到 `lib/hoverStreamBuffer.ts`，导出 `createHoverStreamAccumulator()` 返回 `{ onDelta(text): { show: string | null }, reset() }`，两处共用。

### C-11 `MarkdownView` 的 `dangerouslySetInnerHTML` 依赖 DOMPurify，但 `ADD_ATTR` 白名单偏宽

- **位置**：`apps/web/src/lib/markdown.ts:66-78`
  ```ts
  DOMPurify.sanitize(raw, {
    ADD_ATTR: ['id', 'target', 'rel', 'class', 'data-agent-topic', ...],
  });
  ```
- **问题**：`id`、`class`、`target`、`rel` 全局允许，攻击者若能注入 markdown（作者发文章 / 未来批注 API），可注入 `<a id="x" class="..." target="_blank">` 等；虽 DOMPurify 默认禁 script，但 `id` 冲突、`class` 污染仍可影响页面。
- **修改建议**：
  - 当前 markdown 来源主要是 LLM 输出与作者文章，LLM 输出经净化；作者文章本就是可信内容（作者权限）。风险可控。
  - 但未来若开放批注/评论渲染 LLM 输出，应收紧：对非作者内容用更严配置（`FORBID_ATTR: ['id', 'class']`，仅保留 `data-agent-*`）。
  - 至少把 `target`/`rel` 限制为只允许 `target="_blank"` + `rel="noopener noreferrer"`，而非任意值。
  - 登记为待办，在批注 API 上线前处理。

---

## 4. 🟢 低优先级建议（5 条）

### D-01 `resolveProvider` 的 `byokToProvider(byok || ({ enabled: false } as ByokConfig))` 写法冗余

- **位置**：`providers.ts:117`
- **修改建议**：`byokToProvider` 已在内部判 `!byok?.enabled`，直接 `byokToProvider(byok)` 即可，无需构造空对象。

### D-02 `extractAnthropicParts` 对 `block.text && !block.type` 的兜底可能误收 thinking 块

- **位置**：`providers.ts:545`
  ```ts
  else if (b.text && !b.type) texts.push(String(b.text));
  ```
- **问题**：若上游返回无 `type` 的 thinking 块（带 `text`），会被当正文收。
- **修改建议**：改为仅 `b.type === 'text'` 时收 text；无 type 的块忽略或归 thinking。

### D-03 `buildHoverSystem` 的 memoryBlock 截断 120 字，`buildDeepSystem` 不截断

- **位置**：`agentPrompt.ts:53`（`memoryBlock.slice(0, 120)`）vs `:88`（不截断）
- **问题**：hover 截断 120 字合理（要短），但 deep 不截断可能让 memoryBlock 过长。
- **修改建议**：deep 也加上限（如 800 字），`formatMemoryBlock` 已做 slice(0,12)/slice(0,8)，但 notes 拼接后可能超。统一在 `formatMemoryBlock` 内做总长上限。

### D-04 `maskApiKey` 对 ≤8 字符的 key 返回固定 8 点

- **位置**：`providers.ts:141`
- **问题**：短 key 全部显示为 `••••••••`，无法区分；但短 key 本就不安全，可接受。
- **修改建议**：保持现状；可选改为显示长度。

### D-05 `AGENT_MODE_META` 的 `reasoning` 字段文案含「ReAct-Style」易误导

- **位置**：`agentPrompt.ts:193`
  ```ts
  reasoning: 'Deep ReAct-Style（Thought->Explain->Practice->Next）',
  ```
- **问题**：`docs/architecture/agent-modes.md` 明确「当前非真 tool-loop」，但 `AGENT_MODE_META` 文案叫「ReAct-Style」，`/agent/meta` 接口返回给前端，用户可能误以为是真 ReAct。
- **修改建议**：改为 `'Deep Structured（Thought->Explain->Practice->Next）'`，与 `architecture: 'single-shot structured'` 一致。

---

## 5. 做得好的地方（维持现状）

- **净化体系下沉 shared**：上一轮 M-01 已把正则与函数统一到 `packages/shared/src/hoverSanitize.ts`，前后端 re-export，「只加不减」原则落实彻底；`hoverExplainCache.ts` 与 `agentPrompt.ts` 不再有独立副本。
- **悬停多层防御**：服务端清洗 → 缓存质量门（`isCompleteHoverAnswer`）→ 流式早停（`probeEarlyAnswer`）→ 极简重试（`retryHoverExplain`）→ 前端兜底再过滤；「脏数据永不入库」执行到位。
- **安全基线**：bcrypt 12 轮、JWT_SECRET 长度运行时校验、helmet、双 rate limit、DOMPurify、BYOK key 掩码返回、`TRUST_PROXY` 环境化、`/cache/clear` 限 admin。
- **SSE 中断语义**：`req.on('close')` + AbortController 联动上游（explain/stream 与 chat/stream 均已补齐，上一轮 C-03 已修复），客户端断开即停上游生成。
- **权限模型**：`packages/shared/permissions.ts` 集中管理，`requireRole/requirePermission/requireAdminLevel` 使用到位；`ensureConversation` 有访问控制（登录用户仅本人会话，匿名仅无主会话）。
- **错误分类**：AppError/Zod/Prisma（P2002/2003/2025）统一映射，API 错误格式一致。
- **类型纪律**：两包 `strict: true`，API 侧已补 `noUnusedLocals/noUnusedParameters`。

---

## 6. 修复优先级路线图

| 阶段 | 事项 | 对应条目 |
|------|------|----------|
| **P0**（安全/正确性，先做） | LLM 错误信息脱敏；同步调用加超时；BYOK 静态加密（至少应用层） | A-01 / A-02 / A-03 |
| **P0** | 补 Provider/路由/缓存测试 | A-05 |
| **P1** | deep/chat 安全质检；Provider 重试；responses 真流式或文档标注 | A-04 / B-04 / B-05 |
| **P1** | `agent.ts` 拆分；maxTokens 集中；同步/流式逻辑合并；`PLANNING_HINT_LOCAL` 删除 | C-02 / C-03 / B-02 / C-04 |
| **P2** | AgentFloat 拆分；可观测性打点；缓存清理节流；历史 token 预算 | B-01 / B-06 / B-07 / B-09 |
| **P2** | incompleteKeys 清理；前端流式缓冲抽取；parsePrefs 抽取 | B-11 / C-10 / C-06 |
| **P3** | 类型强化；魔法数清理；DOMPurify 收紧（批注上线前） | C-01 / C-11 / D-* |

---

## 7. 给执行方的说明

1. **每条独立可改**：本报告每条含明确位置与可套用代码，可独立分配给执行方。建议按 P0 → P1 顺序，每改一条跑 `npm test` + `tsc --noEmit`。
2. **A-01/A-02 改造联动**：A-01 引入的 `LlmCallError` 应被 A-02 的超时逻辑复用（超时也抛 `LlmCallError`），建议合并为一个 PR。
3. **A-03 BYOK 加密影响面**：涉及 `settings.ts`（写入）、`loadUserContext`（读取）、`byokToProvider`（使用），三处需同步改；改完务必验证 `/settings/test-llm` 仍可用。
4. **A-04 需测试防回归**：deep 讲解的安全质检容易误杀正常长文讲解，必须先用现有 11 个 hover 测试 + 新增 deep 用例验证。
5. **B-01 AgentFloat 拆分风险最高**：hover 状态机极复杂，拆分易引入回归；建议先补 snapshot 测试（记录关键交互的 SSE 事件序列）再动手；若执行方信心不足，可跳过 B-01，仅做 B-02（后端拆分风险低）。
6. **未涉及**：前端视觉/样式（上一轮 L-09/L-10/L-11）按要求不动；非 Agent 核心的文章/动画/话题路由不在本次范围。
