# AgentForge 双 Agent 体系

> 产品原则：  
> - **悬停 Agent（快速）**：以**速度**为先，架构保持轻量，但**必须有记忆与上下文**。  
> - **Agent 面板（完整智能体）**：面向「可对话的学习伙伴」，具备**完整上下文管理、工具调用、记忆系统、可切换推理模式**等能力。

文档区分 **目标架构（Target）** 与 **当前实现（Current）**，避免把愿景写成已完成。

> 最后核对：2026-08-03

---

## 1. 总览对比

| 维度 | 悬停 Agent · Fast | Agent 面板 · Full Agent |
|------|-------------------|-------------------------|
| **产品角色** | 扫读时的即时讲解 | 可协作的完整智能体 |
| **优先级** | 延迟、稳定性、缓存命中 | 能力完整度、可扩展工具 |
| **触发** | 文章内术语/段落/图表；列表卡片行内替换简介 | 右下角面板对话；「详细讲解」等入口 |
| **目标架构** | 单轮/短上下文 completion；**无工具循环**；读记忆 | **真 tool-loop**；多轮会话；读写记忆；可选推理模式 |
| **当前实现** | 单轮 + 流式 + 双层缓存 + 记忆注入 | 单轮结构化提示词 + 会话消息表 + 记忆注入（**尚未真工具循环**） |

二者共享：BYOK / 服务端 Provider、用户风格、学习进度与 `AgentMemory` 基础设施。

---

## 2. 悬停 Agent（快速）

### 2.1 目标（Target）

| 项 | 说明 |
|----|------|
| **框架定位** | 非 LangChain 类编排；**轻量调用层**（Express + LLM Provider） |
| **架构** | **单轮** completion；**不调用工具**；无状态机循环 |
| **推理模式** | **Fast Direct**：直接给结论；禁止对用户暴露长链 CoT / ReAct 轨迹 |
| **速度手段** | 低 maxTokens、流式正文、L1 浏览器缓存 + L2 服务端缓存、请求冷却与全局串行 |
| **记忆** | **只读注入**为主：已掌握/学习中/最近话题/偏好 |
| **上下文** | 选中片段 + 邻近标题/段落 + 当前路由/文章 slug |
| **输出** | 极短 Markdown（2–3 句、≤220 字）；思考通道仅 UI「思考中」 |
| **体验形态** | 文章内气泡；列表卡片行内替换（全局展开锁） |

### 2.2 当前实现（Current）

- API：`POST /api/v1/agent/explain`、`/explain/stream`，`mode: hover | click`
- Prompt：`buildHoverSystem`（`apps/api/src/lib/llm/agentPrompt.ts`）
- 净化：`extractHoverAnswer` / `isCompleteHoverAnswer` 等在 **`packages/shared/src/hoverSanitize.ts`**（前后端共用）
- 记忆：`loadUserContext` → `formatMemoryBlock` 注入 system（匿名仅含 route）
- 缓存：
  - L2 `HoverExplainCache`：默认 TTL 2h；`hits≥8` → 24h；键 `sha256('v7::' + style + '::' + normalized(topic)).slice(0,48)`；写入前质检
  - L1：`apps/web/src/lib/hoverExplainCache.ts`
- 流式：thinking 不向客户端暴露正文；仅 `status: thinking`（约 120ms 节流）；正文按句 soft-stream（约 90ms）
- 清理：`POST /api/v1/agent/cache/clear`（**admin**）
- **未做**：独立悬停会话表、跨设备同步

### 2.3 后续增强（仍保持轻量）

1. 匿名 `guestKey` 短时「最近悬停主题」  
2. 卡片 / 气泡统一缓存 key（含 style）  
3. 命中缓存时最短「思考中」展示（体验一致）

---

## 3. Agent 面板（完整智能体）

### 3.1 目标（Target）

```
User Message
    → Context Assembler（会话 + 记忆 + 页面/文章 + 系统策略）
    → Reasoning Mode Router（ReAct / Plan-Execute / 纯对话 等）
    → Tool-enabled LLM Loop
         Thought → Tool Call → Observation → … → Final Answer
    → Memory Writer
    → SSE（thinking / 工具状态 / 正文）
```

目标推理模式示例：`react` / `plan_execute` / `deep_teach` / `socratic` / `chat`（与语气 `agentStyle` 正交）。

目标工具示例：`search_articles`、`get_article`、`list_domains`、`get_user_progress`、`save_memory`、可选 `web_search`、MCP tools。

### 3.2 当前实现（Current）

| 项 | 状态 |
|----|------|
| API | `POST /agent/chat`、`/chat/stream`；`mode: fast \| deep`（内部区分，无产品化模式选择器） |
| Prompt | `buildDeepSystem`：`Thought / Explain / Practice / Next`（prompted 骨架，**非真 tool-loop**） |
| 工具循环 | **未实现** |
| 会话 | `AgentConversation` + `AgentMessage`；注入最近 12 条；匿名会话 TTL 7 天 |
| 摘要 | 消息 > 24 条时压缩最旧 8 条到 `summary` |
| 记忆 | 读 `AgentMemory` + `LearningProgress`；启发式「请记住…」写入 preference；`POST /progress` 在 mastered 时追加记忆 |
| 流式 | deep：thinking / delta / final；fast：status + final |
| maxTokens | fast：同步约 700 / 流式约 500；deep：约 2048 |
| 推理模式 UI | **未实现** |
| MCP | 仅状态探测；进程未实现 |
| 独立 Runtime | `services/agent` 仅 README；逻辑仍在 `apps/api` |

### 3.3 面板落地路线（建议）

| 阶段 | 内容 |
|------|------|
| **P0** | 真 tool-loop 最小集：`search_articles`、`get_article` + ReAct；工具状态 SSE |
| **P1** | 会话列表 UI、记忆写入确认、模式切换 |
| **P2** | MCP 对接、更多工具、评测与限流 |

---

## 4. 共享基础设施

| 模块 | 路径/表 |
|------|---------|
| Prompt | `apps/api/src/lib/llm/agentPrompt.ts` |
| 净化 | `packages/shared/src/hoverSanitize.ts` |
| Provider | `apps/api/src/lib/llm/providers.ts` |
| 路由 | `apps/api/src/routes/agent.ts` |
| 会话/消息 | `AgentConversation` / `AgentMessage` |
| 悬停缓存 | `HoverExplainCache` + `apps/web/.../hoverExplainCache.ts` |
| 面板 UI | `apps/web/src/components/agent/AgentFloat.tsx` |
| 卡片 UI | `apps/web/src/components/article/ArticleCardInlineAgent.tsx` |

---

## 5. 安全与限流

- Agent 路径 40 req/min；全站 120/min  
- BYOK 仅服务端、脱敏展示  
- 详见 `docs/security.md`

---

## 6. 与「框架」一词的澄清

| 说法 | 含义 |
|------|------|
| **不是** | 当前面板 = 已接入 LangChain/CrewAI 生产编排 |
| **是** | 自研 API + Provider +（目标）可拆分 Agent Runtime |
| **MCP** | 对外工具/资源协议预留，见 `services/mcp/README.md` |

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-08-03 | 缓存键 `v7`；净化迁入 `@agentforge/shared`；明确 Agent 已在 apps/api 实装、非 501；admin 才能清缓存 |
| 2026-07-23 | 对照代码纠正 TTL、mode=fast\|deep、三种 Provider 格式、MCP/Runtime 未实现 |
| 2026-07-12 | 明确双 Agent 目标：面板 = 完整可工具智能体；悬停 = 速度优先 + 记忆 |
