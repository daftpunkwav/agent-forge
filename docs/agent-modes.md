# AgentForge 双 Agent 体系

> 产品原则：  
> - **悬停 Agent（快速）**：以**速度**为先，架构保持轻量，但**必须有记忆与上下文**。  
> - **Agent 面板（完整智能体）**：面向「可对话的学习伙伴」，具备**完整上下文管理、工具调用、记忆系统、可切换推理模式**等能力。

文档区分 **目标架构（Target）** 与 **当前实现（Current）**，避免把愿景写成已完成。

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
| **架构** | **单轮**（或极短多轮）completion；**不调用工具**；无状态机循环 |
| **推理模式** | **Fast Direct**：直接给结论；禁止对用户暴露长链 CoT / ReAct 轨迹 |
| **速度手段** | 低 maxTokens、流式正文、L1 浏览器缓存 + L2 服务端缓存、请求冷却与全局串行 |
| **记忆** | **只读注入**为主：已掌握/学习中/最近话题/偏好，调节讲解深度与用语 |
| **上下文** | 选中片段 + 邻近标题/段落 + 当前路由/文章 slug；可选匿名 session 级最近 N 条悬停主题 |
| **输出** | 极短 Markdown（2–4 句或短 bullet），可流式；思考通道仅 UI「思考中」 |
| **体验形态** | 文章内：固定位置气泡；列表卡片：行内替换简介（全局展开锁防布局抖动） |

### 2.2 当前实现（Current）

- API：`POST /api/v1/agent/explain`、`/explain/stream`，`mode: hover`
- Prompt：`buildHoverSystem`（Fast Direct 规则）
- 记忆：`loadUserContext` → `formatMemoryBlock` 注入 system
- 缓存：服务端 `HoverExplainCache`（热 key 延长 TTL）+ 前端 L1
- 流式：正文 `delta`；thinking 不入展示；`extractHoverAnswer` 清洗 final
- **未做**：独立悬停会话表、跨设备同步悬停历史

### 2.3 后续增强（悬停侧，仍保持轻量）

1. 匿名 `guestKey` 下的短时「最近悬停主题」上下文  
2. 卡片 / 气泡统一缓存 key（含 style）  
3. 命中缓存时仍保证最短「思考中」展示（体验一致）

---

## 3. Agent 面板（完整智能体）

### 3.1 目标（Target）— 真正可调用工具的智能体

面板 Agent 应达到「学习平台内的完整 Agent」，而不仅是聊天框。

#### 3.1.1 运行时架构（Target）

```
User Message
    → Context Assembler（会话 + 记忆 + 页面/文章 + 系统策略）
    → Reasoning Mode Router（ReAct / Plan-Execute / 纯对话 等）
    → Tool-enabled LLM Loop
         Thought → Tool Call → Observation → … → Final Answer
    → Memory Writer（重要事实 / 进度 / 会话摘要）
    → SSE 流式返回（thinking 可折叠 / 工具状态 / 正文）
```

| 层 | 职责 |
|----|------|
| **编排** | 自研 Agent Runtime（可落在 `apps/api` 或独立 `services/agent`）；可选后续对接 LangGraph 等，但接口对前端稳定 |
| **模型** | 用户 BYOK + 服务端默认 Provider；支持 Anthropic Messages / OpenAI Chat 等 |
| **协议** | 站内 SSE；对外预留 **MCP**（`services/mcp`）作为工具/资源暴露 |

#### 3.1.2 推理模式（Target）

面板应支持**可配置/可切换**的推理模式，例如：

| 模式 ID | 说明 | 适用 |
|---------|------|------|
| `react` | 真 ReAct：Thought → Tool → Observation 循环 | 查资料、算例、读文章段落 |
| `plan_execute` | 先计划再逐步执行工具 | 多步作业、对比多概念 |
| `deep_teach` | 教学结构：Explain + Practice + Next（可夹带工具） | 系统讲解 |
| `socratic` | 多反问 + 少量工具验证 | 引导式学习 |
| `chat` | 轻多轮对话，工具按需 | 闲聊式答疑 |

模式选择：用户设置默认 + 单次对话可覆盖；与 `agentStyle`（语气）正交。

#### 3.1.3 工具调用（Target）

内置工具示例（按优先级）：

| 工具 | 作用 |
|------|------|
| `search_articles` / `get_article` | 站内知识检索与正文片段 |
| `list_domains` | 领域导航 |
| `get_user_progress` | 学习进度 |
| `save_memory` | 写入长期记忆（需策略与确认） |
| `web_search`（可选） | 前沿资讯（限域/限流） |
| **MCP tools** | 外部 Host 或站内 MCP Server 注册的工具 |

要求：参数 Zod 校验、超时、次数上限、审计日志、对用户展示「正在调用 xxx」。

#### 3.1.4 上下文管理（Target）

| 类型 | 说明 |
|------|------|
| **会话** | 多会话列表；当前 `conversationId`；标题自动生成 |
| **窗口** | 最近 K 轮原文 + 滚动摘要（超长压缩） |
| **页面上下文** | 当前路由、文章 slug、选中段落（可选） |
| **系统策略** | 角色、安全、教学模式、是否允许某类工具 |
| **用户可控** | 清空会话、删除记忆条目、导出对话（后续） |

#### 3.1.5 记忆系统（Target）

| 层级 | 存储 | 读写 |
|------|------|------|
| **工作记忆** | 当前会话 messages + 临时 tool 结果 | 每轮 |
| **会话摘要** | `AgentConversation.summary` | 超长时压缩写入 |
| **长期记忆** | `AgentMemory`（fact / skill / preference / summary） | 助手可写；用户可在设置中管理 |
| **学习状态** | `LearningProgress` | 阅读/标记已掌握时写；组装上下文时读 |

写入策略：显式「请记住」；或模式允许时由 Agent 提议写入（可开关）。

#### 3.1.6 前端面板能力（Target）

- 流式正文 + 可折叠思考过程 + **工具调用时间线**  
- 会话切换 / 新建 / 删除  
- 推理模式与风格选择  
- 停止生成、重试  
- 引用当前文章 / 插入选区再问  

### 3.2 当前实现（Current）

| 项 | 状态 |
|----|------|
| API | `POST /agent/chat`、`/chat/stream`；`mode: deep` 为主 |
| Prompt | `buildDeepSystem`：Prompted 结构 `Thought/Explain/Practice/Next` |
| 工具循环 | **未实现**（无真实 Tool Call / Observation） |
| 会话 | `AgentConversation` + `AgentMessage` 持久化；system 注入近期轮次与 summary |
| 记忆 | 读 `AgentMemory` + `LearningProgress`；写「请记住」类启发式 + 进度 API |
| 流式 | thinking / delta / final；UI 默认收起思考 |
| 推理模式切换 | **未产品化**（仅 deep/fast 粗分） |
| MCP | 状态接口与 `services/mcp` 文档占位 |

### 3.3 面板落地路线（建议）

| 阶段 | 内容 |
|------|------|
| **P0** | 真 tool-loop 最小集：`search_articles`、`get_article` + ReAct 模式；工具状态 SSE |
| **P1** | 会话列表 UI、摘要压缩策略、记忆写入确认、模式切换 |
| **P2** | MCP 对接、更多工具、评测与限流、多模型路由 |

---

## 4. 共享基础设施

```
                    ┌─────────────────────┐
                    │   LLM Providers     │
                    │  BYOK / 服务端默认   │
                    └──────────┬──────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         ▼                     ▼                     ▼
 ┌───────────────┐    ┌────────────────┐    ┌────────────────┐
 │ 悬停 Explain  │    │ 面板 Chat Loop │    │ 记忆 / 进度 API │
 │ Fast Direct   │    │ Full Agent     │    │ AgentMemory    │
 └───────────────┘    └────────────────┘    │ LearningProg.  │
         │                     │            └────────────────┘
         └──────────┬──────────┘
                    ▼
            前端：AgentFloat
            卡片：Inline Agent
```

| 模块 | 路径/表 |
|------|---------|
| Prompt | `apps/api/src/lib/llm/agentPrompt.ts` |
| Provider 流式 | `apps/api/src/lib/llm/providers.ts` |
| 路由 | `apps/api/src/routes/agent.ts` |
| 会话/消息 | `AgentConversation` / `AgentMessage` |
| 悬停缓存 | `HoverExplainCache` + `apps/web/src/lib/hoverExplainCache.ts` |
| 面板 UI | `apps/web/src/components/agent/AgentFloat.tsx` |
| 卡片 UI | `apps/web/src/components/article/ArticleCardInlineAgent.tsx` |

---

## 5. 安全与限流（两模式共通）

- 全站 rate limit；Agent 路径更严  
- 工具参数校验、超时、禁止任意代码执行  
- BYOK Key 仅服务端存、脱敏展示  
- 记忆写入防注入与长度限制  
- 详见 `docs/security.md`

---

## 6. 与「框架」一词的澄清

| 说法 | 含义 |
|------|------|
| **不是** | 当前面板 = 已接入 LangChain/CrewAI 生产编排 |
| **是** | 自研 API + Provider +（目标）自研/可插拔 Agent Runtime |
| **MCP** | 工具与资源的对外协议预留，见 `services/mcp/README.md` |

悬停保持 **无框架编排** 的薄调用；面板目标为 **完整 Agent Runtime**，可在不改前端协议的前提下替换内部编排实现。

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-07-12 | 明确双 Agent 目标：面板 = 完整可工具智能体；悬停 = 速度优先 + 记忆/上下文 |
| 更早 | 描述当时「Prompted ReAct 骨架 / Fast Direct」实现 |
