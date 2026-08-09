---
type: 系统组件
title: ReAct tool-loop（P0 工具循环）
description: prompt-based TOOL_CALL 协议、runToolLoop 循环、白名单工具注册表、search_articles/get_article 工具与安全护栏。
tags: [agent, tools, react, tool-loop]
---

# ReAct tool-loop（P0）

面板 Agent 的「允许工具」（`reasoningMode: 'react'` 或 `toolsEnabled: true`）启用 **prompt-based ReAct tool-loop**：模型输出 `TOOL_CALL: {json}` 单行协议（非原生 tools API，跨 Provider 通用），服务端执行白名单工具并把 Observation 回注上下文，循环至最终答案或迭代上限。实现：`lib/llm/tools/`（toolLoop / registry / parseToolCall / searchArticles / getArticle）。

## 循环流程

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    A["system: buildReactSystem<br/>TOOL_CALL 协议 + 工具清单"] --> B["callLlm (mode:deep, 每轮)"]
    B --> C["parseToolCall(combined)<br/>TOOL_CALL 行 + JSON 解析"]
    C -->|无 TOOL_CALL| D["extractVisibleAnswer → 最终答案"]
    C -->|有 TOOL_CALL| E["executeTool: 白名单 + Zod + 8s 超时"]
    E --> F["messages += assistant TOOL_CALL 行<br/>+ user Observation(工具结果)"]
    F --> G{"迭代数 < maxIters?"}
    G -->|是| B
    G -->|否| H["兜底文案：达到工具调用次数上限"]
    D --> I["SSE: thinking / delta / final"]
    E -.->|onEvent| I
    I --> J["finalizeChatTurn 持久化"]
```

## 关键实现（lib/llm/tools/）

### parseToolCall.ts
- 协议：单独一行 `TOOL_CALL: {"name":"...","args":{...}}`；正则 `TOOL_CALL:\s*(\{[^\n]*\})` + `JSON.parse`；name 非空字符串才有效；`hasToolCall()` 供判断「工具轮不得当最终答案展示」。

### registry.ts（安全护栏核心）
- 白名单恰为 **`search_articles` / `get_article`**（`listToolNames()`）；`isAllowlistedTool` 拒绝未知名。
- `executeTool(name, rawArgs, ctx)`：未知名 → 非抛错 observation **`Error: unknown or disallowed tool "X". Allowed: search_articles, get_article`**；Zod 校验失败 → **`Error: invalid args for <name>: <path>: <message>`**（多 issue 以 `; ` 连接，缺路径用 `args`）；执行异常/超时 → 对应错误 observation（超时 → `Error: tool <name> timed out`）。**所有失败都进 pino 审计**（event tool_call、name/ok/ms/reason），不留密钥。

### toolLoop.ts（runToolLoop）
- 参数：`maxIters`（默认 `TOOL_LOOP_MAX_ITERS` = env 或 5，钳制 1–20）、`toolTimeoutMs`（默认 `TOOL_TIMEOUT_MS` = env 或 8000ms，**下限钳制 1000ms**）、`signal`（客户端断开）、`onEvent`（SSE 回传）。
- 每轮 `callLlm(mode:'deep')`；`combined = text + thinking` 双通道解析 TOOL_CALL；无调用 → `extractVisibleAnswer` 收尾（含 thinking 事件回传）。
- 工具执行信号 = 外层 abort 与单次超时合成（`AbortSignal.any`，Node <20.3 退化为仅超时，循环顶部检查外层 abort）。
- **maxIters 兜底**：达上限 → 固定文案「已达到工具调用次数上限…」，返回 `hitMaxIters: true` **且 `iterations: maxIters`**（不会把半截当答案）。
- SSE 事件：`tool_call`（name/args）→ `tool_result`（name/ok/preview ≤160 字）→（最终轮）`delta`/`final`。

### 工具定义

**search_articles**：`{ q: 1–200, take?: 1–20 }`，**缺省 take=8**；只搜 **published** 文章（title/summary/slug 包含）；返回 JSON observation：count + items（title/slug/summary ≤240/category/level）；无匹配给 hint 文案。

**get_article**：`{ slug: 1–120 }`；只取 **published** 文章；markdown 截断 **4000 字符**（`GET_ARTICLE_MAX_CHARS`，防止 observation 撑爆上下文），返回 truncated/totalChars 标记。

## 启用路径

- `POST /agent/chat` 或 `/chat/stream` 带 `reasoningMode: 'react'` 或 `toolsEnabled: true`（`resolveReactEnabled`）。
- 前端：面板 footer「允许工具」勾选 → `useAgentPanel` 的 `send()` 加 `reasoningMode:'react'`，SSE 超时从默认 28s 拉长到 **90s**（tool-loop 多轮耗时）。

## 聚焦测试（lib/llm/tools/tools.test.ts）

- parseToolCall：合法单行解析、无调用/坏 JSON/缺 name → null。
- 白名单：`listToolNames()` 恰为两个工具；`web_search` 不在白名单；`rm_rf` → ok:false + `/unknown or disallowed/i`；Zod 失败（q 空）→ `/invalid args/i`。
- search_articles 成功 → observation JSON 含命中项。
- **maxIters**：模型持续输出 TOOL_CALL → 3 轮后 `hitMaxIters:true`、callLlm 恰 3 次、3 个 tool_call + 3 个 tool_result 事件、答案含「上限」；无调用 → 1 轮收尾、答案含正文。
- mock：`vi.mock('../../prisma.js')`（article.findMany/findFirst）+ `vi.mock('../providers.js')`（callLlm）+ 静音 logger。

## 变更面与路线

- **新增工具配方**：`types.ts` 定义 `ToolDefinition`（name/description/schema/execute）→ 实现文件 → 加入 `registry.ts` 的 `TOOLS` 数组 → 同步 `buildReactSystem` 的工具清单文字。
- **P1/P2 未实现**（`docs/tool-loop-roadmap.md`）：更多只读工具（list_domains/get_user_progress）、save_memory 带写权限确认、完整推理模式选择器 UI、**observation 注入防御**（长度上限、敏感字段剥离、防工具输出伪装 system 指令）、tool-loop 独立限流、原生 function-calling 适配、MCP 对接与独立 Runtime 拆分。

## 相关页面

- 面板上下文与持久化：[面板对话](./chat-panel.md)
- Provider 调用层：[LLM Provider](./llm-providers.md)
