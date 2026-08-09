---
type: 前端功能
title: Agent UI 全链路（悬停气泡、面板、L1 缓存与限流）
description: AgentFloat 悬停目标识别与揭示时序、useAgentPanel 消息状态机、agentStream SSE 读取、hoverExplainSession 统一状态机与 L1 缓存。
tags: [frontend, agent, hover, sse, cache]
---

# Agent UI 全链路

前端 Agent 交互由 `AgentFloat`（全局壳）承载，拆成四个可复用层：`hoverTarget`（目标识别）、`hoverExplainSession`（悬停状态机）、`hoverExplainCache`（L1 缓存）、`useAgentPanel`（面板状态机），流式读取统一走 `agentStream.ts`。

## 组件地图

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    AF["AgentFloat.tsx<br/>悬停气泡 + 面板壳"] --> HT["hoverTarget.ts<br/>目标识别/稳定 key/高亮"]
    AF --> SS["hoverExplainSession.ts<br/>runHoverExplainStream"]
    AF --> PN["useAgentPanel.ts<br/>面板消息状态机"]
    SS --> SB["hoverStreamBuffer.ts<br/>按句安全前缀"]
    SS --> C1["hoverExplainCache.ts<br/>L1 20min LRU64 + 事件"]
    PN --> AS["agentStream.ts<br/>SSE 读取 28s 超时"]
    AS --> API["/api/v1/agent/explain|chat/stream"]
    C1 -.->|sanitize 别名| SH["@agentforge/shared 净化"]
```

## hoverTarget.ts（目标识别）

- `isKnowledgeRoute`：仅 `/knowledge/:slug`、`/llm/:slug`（排除总览页）；`inKnowledgeZone` 限定正文/动画区。
- 三层识别：作者标注（`[data-agent-term/topic/text/hint]`）→ SVG/图表节点（`g[data-node-id]`、text/tspan，动画重绘后 `elementsFromPoint` 兜底）→ 光标短语（`caretRangeFromPoint`）。
- `stableKey`（viz|nodeId|term|heading 拼接）保证动画重绘/同文案不同 DOM 续会话；`SKIP_CLOSEST` 排除面板/控件自身。

## AgentFloat.tsx（悬停时序，核心常量）

| 常量 | 值 | 含义 |
|------|----|------|
| HOVER_SETTLE_MS | 60 | 目标稳定 debounce（防嵌套元素抖动） |
| HOVER_REVEAL_MS | 700 | 满 ~0.7s 才揭示气泡（后台立即预取） |
| HOVER_MIN_THINK_MS | 160 | 气泡出现后最短「思考中」展示 |
| HOVER_LEAVE_KEEP_MS | 3000 | 移出保留 3s；指针在气泡内不消失 |
| FADE_MS | 180 | 渐出动画 |
| REQUEST_COOLDOWN_MS | 280 | 新目标请求最小间隔 |
| MAX_REQUESTS_PER_WINDOW | 8 / 10s | 窗口限流（扫射防护） |

时序：`mouseover`（capture）→ 目标稳定 → `startPrefetch`（先查 L1 `peekHoverSessionCache`，命中则不请求 LLM）→ reveal 后先显示「思考中」→ 网络/缓存答案就绪 → `scheduleAnswerReveal`（保证最短思考展示）→ 离开保留 3s → 渐出。切换目标 abort 上一路；全局 `inflightKeyRef` 串行化同一时间只允许一个 hover 请求；**未完成/未揭示的会话标记 incomplete**（`IncompleteHoverKeys`，TTL 5min、上限 200，**超限按时间戳淘汰最旧标记**；incomplete 期间禁止把半截当缓存命中——`peekHoverSessionCache` 直接短路返回 null，B-11）。

## hoverExplainSession.ts（统一状态机）

`runHoverExplainStream(params)`：L1 peek（`skipCacheRead` 可跳；**`peekHoverSessionCache` 在 incomplete 键处于 TTL 内时直接拒绝读 L1**，返回 `{key, cached:null}`）→ mark incomplete → `streamAgent('/agent/explain/stream', {mode:'hover'})` → delta 经 `hoverStreamBuffer` 累积出「可展示安全前缀」（`onPartial`）→ `final` 事件到达即 `settle()`（**只信 final.answer**，禁止用缓冲原文回退成思考；**`onFinal` 在 final 事件时刻触发、不等待 Promise settle**，与揭示时序一致）→ 文本过 `isSafeHoverDisplay` 才 `pushHoverSessionCache` 写 L1 并**清 incomplete 标记**，否则**重新 mark incomplete**；失败/超时 → 兜底文案 `failMessage`、mark incomplete。

`smartTruncateClient(s, max=560)`：超过上限先取前 max 字符；`。`/`！` 的最后出现位置 **≥ 45% 上限处（`end >= floor(max*0.45)`）** 才切句截断，否则剥掉末尾不完整拉丁词（`/[A-Za-z]{1,12}$/`）；**`？` 从不作为合法句末**（改稿自问）。`sanitizeHoverAnswer`（shared `sanitizeHoverDisplay` 后 smartTruncateClient）。

## hoverExplainCache.ts（L1）

- TTL 20min、LRU 上限 64（**Map 插入序淘汰最旧 key**；命中即 `delete+set` 重贴时间戳，读操作刷新 TTL）；key = `style::topic`（**明文**；默认 style `professional`——`hoverCacheKey(topic, style='professional')`；与后端 L2 sha256 版本化 key 不同——两端独立查询无需一致，L1 不版本化，随 L2 升级自然失效）。
- **topic 归一化与 L2 一致**：trim + 小写 + 空白折叠 + 截 400 字（L2 另加 `v7::` 版本前缀与 sha256，见 [悬停 Agent](../agent/hover-agent.md)）。
- 读写均过 `isSafeHoverDisplay`（shared）；脏缓存读取时直接丢弃，绝不写入。
- `clearAllHoverCaches()`：清空本模块 Map 并 `window.dispatchEvent(new CustomEvent('agentforge:agent-cache-cleared', { detail: { clearedL1 } }))`（事件常量 `AGENT_CACHE_CLEARED_EVENT`），**AgentFloat 与行内卡片组件各自监听并清空自身 Map**；设置页「清除 Agent 缓存」先调它，再调服务端 L2 清理（`POST /api/v1/agent/cache/clear`，返回 `cleared` 条数 + `scope:'hover-explain-l2'`）。

## useAgentPanel.ts（面板状态机）

- 消息数组 `ChatMsg { role, text, thinking, streaming, thinkingOpen }`；`busy`、`toolsEnabled`（勾选 → `reasoningMode:'react'`）。
- `deepExplain(text, title?, articleSlug?)`：文章「Agent 详细讲解」→ `/agent/explain/stream` mode=click（选中片段 ≤3500 字）。
- `send()`：`/agent/chat/stream`，带 conversationId（来自 meta 事件）/guestKey/context.route；**toolsEnabled 时 SSE 超时拉长到 90s**；SSE 事件 → 消息 patch：`tool_call` → 工具状态行（`_正在检索文章…_`）、`thinking` → thinking 字段（默认收起）、`delta` → 正文追加、`final` → 结算、`error` → `**错误**\n\n消息`。
- `fallback`：流失败时降级同步调用 `api.agentExplain/agentChat`。
- 卸载时 abort 进行中的流。

## agentStream.ts（SSE 读取）

- `StreamEvent` 联合类型（meta/status/thinking/delta/tool_call/tool_result/final/done/error）；delta 可带 `replace`（策划切讲解时的重同步）。
- 默认 **28s 超时**（`timeoutMs` 可覆盖）；**独立 `timedOut` 标志**区分「超时」与「主动取消」（C-09）——超时 → 「讲解超时，请再悬停试一次」；主动取消（AbortError 且调用方 signal aborted）原样抛出。
- 逐行解析 `data:` 前缀 JSON；服务端非 2xx 时解析 `error.message` 抛错。

## MarkdownView.tsx（渲染边界）

`renderMarkdown(source)`（shared 白名单，见 [Markdown 管线](./markdown-pipeline.md)）→ `dangerouslySetInnerHTML`，类 `.agent-md`（`compact` → `.agent-md-compact`）。**这是 LLM 输出 Markdown 唯一的 sanitize→注入点**，气泡与卡片共用。

## 聚焦测试

前端无单测文件；行为证据在后端 SSE 契约测试（`routes/agent.sse.test.ts`）与共享净化测试（`agentPrompt.hover.test.ts` / `smoke.test.ts`）。状态机（incomplete TTL、展开锁、超时 vs 取消）以源码常量与注释为据。

## 相关页面

- 后端契约：[双 Agent 体系总览](../agent/overview.md) / [悬停 Agent](../agent/hover-agent.md) / [面板对话](../agent/chat-panel.md)
- 净化：[提示词与净化](../agent/prompt-sanitize.md)
