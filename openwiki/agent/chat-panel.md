---
type: 系统组件
title: Agent 面板对话（会话、记忆与持久化）
description: /api/v1/agent/chat(+stream) 的上下文装配、会话 ACL 与匿名 TTL、历史 token 预算、滚动摘要、记忆写入启发式与进度端点。
tags: [agent, chat, conversation, memory]
---

# Agent 面板对话

面板 Agent 是可对话的学习助手（右下角 `AgentFloat` 面板壳 + `useAgentPanel`），支持 `mode: fast | deep` 与 ReAct tool-loop（见 [ReAct tool-loop](./tool-loop.md)）。编排在 `services/agentOrchestrator.ts`（`prepareChat`/`finalizeChatTurn`），会话在 `services/agentConversation.ts`，记忆在 `services/agentMemory.ts`。

## 请求与上下文装配

`chatSchema`：`message`（1–4000）、`conversationId`（≤64）、`guestKey`（16–80，匿名会话 ACL）、`context { route, articleSlug, sectionId }`、`style`、`mode`（fast|deep）、`reasoningMode`（deep_teach|react）、`toolsEnabled`（与 react 等价快捷开关）。

`prepareChat(body, userId)` 步骤：

1. `loadUserContext`（风格/记忆/解密 BYOK）→ `resolveProvider`（无 Provider → 400 NO_PROVIDER）。
2. `ensureConversation`：登录 → 仅本人会话；匿名 → 必须 `guestKey` 匹配（无 guestKey 的旧匿名会话**不可续写**，防 IDOR）；过期/他人会话 → 新建（匿名新会话 `expiresAt` = 7 天）。
3. `loadRecentMessages`（≤12 条最新）→ 按 mode 的 **token 预算从最新向前累加**：fast 600 / deep 2000（`estimateTokens`：中文 ~1.5 字/token、英文 ~0.25 词/token），替代固定条数截断（B-09）。
4. system = 模式 prompt（`buildDeepSystem`/`buildHoverSystem`/`buildReactSystem`）+ `【会话摘要】` + `【近期对话】`；userContent 追加路由/文章上下文。

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
sequenceDiagram
    participant FE as useAgentPanel
    participant RT as routes/agent.ts
    participant OR as agentOrchestrator
    participant CV as agentConversation
    participant MM as agentMemory
    participant PR as callLlm / runToolLoop

    FE->>RT: POST /chat/stream {message, conversationId?, guestKey?, mode, style, reasoningMode?}
    RT->>OR: prepareChat
    OR->>MM: loadUserContext (记忆/进度/BYOK)
    OR->>CV: ensureConversation (ACL + 匿名 TTL)
    OR->>CV: loadRecentMessages → 预算内历史块
    OR-->>RT: system + userContent + conv
    RT-->>FE: meta (conversationId, guestKey, reasoningMode)
    alt reactEnabled
        RT->>PR: runToolLoop (tool_call/tool_result/delta 事件)
    else deep/fast
        RT->>PR: callLlm / streamLlm
    end
    RT->>OR: extractVisibleAnswer 门控（A-04）
    RT->>OR: finalizeChatTurn
    OR->>CV: persistTurn (user+assistant 消息, >24 条滚动摘要)
    OR->>MM: rememberTopic + maybeSaveImportantMemory
    RT-->>FE: final → done（先持久化再 final，I5）
```

## 会话生命周期（agentConversation.ts）

- **匿名 TTL**：7 天（`GUEST_CONV_TTL_MS`）；过期清理节流每 10 分钟一次（`maybePurgeGuestConversations`，防高并发全表扫描，B-07）。
- **IDOR 防护**：匿名续写必须回传 `guestKey`（服务端校验相等）；历史无 guestKey 的会话不可续写。
- `createGuestKey()` = `randomBytes(24).base64url`（前端持久化在 localStorage `agentforge-guest-key`，≥16 字符）。
- **滚动摘要**：`persistTurn` 写 user + assistant 两条消息（content ≤4000/8000、thinking ≤4000）；消息 >24 条时把最旧 8 条压缩成 ≤500 字 `summary`（不删消息，摘要注入 system）。

## 记忆写入（agentMemory.ts）

- **话题记忆**：`rememberTopic(userId, topic, mode)` → key `seen:{topic前80字}`，值「用户在 X 模式询问过…」（fire-and-forget，失败留痕不断链）。
- **偏好记忆**（启发式）：用户消息命中 `/请记住|记住：|我的偏好|以后.*用/` → key `pref:{sha256(userMsg).hex前16}`（**稳定哈希 key**：同消息重复写只覆盖不新增，杜绝无限增长）；kind=preference；每用户 `pref:` 前缀 ≤20 条，超出按 updatedAt 淘汰最旧（B-08）。
- **进度写入**：`POST /agent/progress` upsert `LearningProgress`；`progress` 只增不减；`mastered` **不可降级**；置为 mastered 时自动写 `AgentMemory(key='mastered:{slug}', kind=skill)`。
- 上下文读取：mastered = `mastery==='mastered' || progress>=0.85`，learning 为其余；`formatMemoryBlock` 总长 ≤800 字（D-03）。

## 流式与收尾

- deep：thinking（per-delta isSystemEcho 过滤，I3）+ delta + final（thinking = `safeThinking || visible.thinking`）；fast：只发 `status: thinking` + final。
- **I5 不变量**：`finalizeChatTurn`（持久化）成功后才发 `final`/`done`——done 之后客户端视为结束，persist 失败不会用错误文案覆盖已交付答案。
- 兜底：`extractVisibleAnswer` 门控把答案清空时不回传空回复（统一文案「抱歉，这一轮没有生成有效讲解…」），且不持久化空消息。
- 客户端断开 → abort 上游；`llmAbort.signal.aborted` 时跳过入库。

## 端点速查（requireAuth）

- `GET /agent/memory`：当前用户记忆（≤100）。
- `POST /agent/memory`：upsert（key 1–120、value 1–2000、kind）。
- `POST /agent/progress`：`{ articleSlug, progress?, mastery? }`（行为见上文）。

## 聚焦测试

- `services/agentConversation.test.ts`：他人会话→新建、匿名过期→新建（7 天 TTL）、guestKey 匹配复用、**IDOR（guestKey 不匹配/历史无 key）→ 新建**。
- `routes/agent.sse.test.ts`：deep 模式 thinking 过滤 + final/done 顺序（与悬停共用同一 mock 基建）。
- `lib/llm/tools/tools.test.ts`：react 路径的 tool-loop 行为（见 [ReAct tool-loop](./tool-loop.md)）。

## 相关页面

- 前端消息状态机：[Agent UI](../frontend/agent-ui.md)
- Provider/超时/重试：[LLM Provider](./llm-providers.md)
- 提示词与净化：[提示词与净化](./prompt-sanitize.md)
