---
type: 系统组件
title: LLM Provider 抽象（加载、解析、调用、流式）
description: ProviderConfig/ByokConfig 模型、环境变量加载与启动缓存、BYOK 优先解析、callLlm 超时重试、streamLlm 三格式分派与 adapters。
tags: [agent, llm, providers, streaming]
---

# LLM Provider 抽象

所有 LLM 调用经由 `lib/llm/` 统一抽象：`types.ts`（模型）、`config.ts`（参数单一真相）、`providers.ts`（加载/解析/调用/流式）、`providerHttp.ts`（错误/超时/重试工具）、`adapters/`（三种 API 格式）、`tools/`（tool-loop，见 [ReAct tool-loop](./tool-loop.md)）。

## 类型模型（types.ts）

- `ApiFormat = 'anthropic_messages' | 'openai_chat' | 'openai_responses'`；`API_FORMATS` 常量带中文说明（设置页展示）。
- `LlmRequest { messages, mode: 'fast'|'deep', maxTokens?, temperature?, images?, signal? }`。
- `LlmResponse { text, thinking?, model, format, usage? }`；`StreamChunk = thinking | text` 分片。
- `ProviderConfig { id, name, baseUrl, apiKey, model, format, vision }`；`ByokConfig`（用户偏好版，多 `name/vision` 可空）。

## 参数单一真相（config.ts，C-03）

```ts
LLM_TOKEN_LIMITS = {
  hover:      { maxTokens: 220,  temperature: 0.15 },  // 悬停快讲
  hoverRetry: { maxTokens: 220,  temperature: 0.1  },  // 空答兜底重试
  chatFast:   { maxTokens: 600,  temperature: 0.3  },
  chatDeep:   { maxTokens: 2048, temperature: 0.55 },
  clickDeep:  { maxTokens: 2048, temperature: 0.55 },
}
LLM_CALL_TIMEOUT_MS = 30_000      // A-02 同步/流式统一超时
HOVER_RETRY_TIMEOUT_MS = 12_000   // 次要路径短超时
LLM_RETRY_BACKOFF_MS = 500        // B-05 单次重试退避
TOOL_LOOP_MAX_ITERS = env||5 (1–20)
TOOL_TIMEOUT_MS = env||8000 (min 1000)
```

调用方（agent.ts / settings.ts / agentOrchestrator）显式从本表取值传参；`tokenDefaults` 只是「调用方未传参」的防御性兜底。

## 加载与解析（providers.ts）

- `loadProviders()`：从环境变量加载服务端默认 Provider（**进程启动后缓存一次**，B-03；测试用 `resetProviderCache()` 重置）：

| Provider | 环境变量 | 默认值 |
|----------|----------|--------|
| stepfun | `STEPFUN_API_KEY`（或 `LLM_API_KEY`）/ `STEPFUN_BASE_URL` / `STEPFUN_MODEL` / `STEPFUN_API_FORMAT` | base `https://api.stepfun.com/step_plan`、model `step-3.7-flash`、format anthropic_messages |
| openai | `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `OPENAI_MODEL` / `OPENAI_API_FORMAT` | `https://api.openai.com/v1`、`gpt-4o-mini`、openai_chat |
| generic | `GENERIC_LLM_API_KEY` + `GENERIC_LLM_BASE_URL`（缺 base 则过滤掉）/ `GENERIC_LLM_NAME/MODEL/API_FORMAT/VISION` | model `default`、openai_chat；**vision 仅当 `GENERIC_LLM_VISION=true` 时开启**（默认 false，与 stepfun/openai 默认 true 不同） |

- `getDefaultProvider()`：`LLM_PROVIDER_ID` 优先（默认 stepfun），否则列表首个。
- `byokToProvider(byok)`：enabled + baseUrl/apiKey/model 齐全才有效；**SSRF 校验**（`assertSafeByokBaseUrl`）只作用于用户 BYOK。
- `resolveProvider(byok)`：**BYOK 优先，其次服务端默认**（失效 BYOK 自动回退）。
- `listPublicProviders()`：公开元数据（baseUrlHost 用 `safeHost` 只给 host）；`maskApiKey`：≤8 位全掩码，否则前 4 后 4。

## callLlm：同步调用（超时 + 重试 + 打点）

1. `withTimeout(req)`：`AbortSignal.timeout(30s)` 与调用方 signal 合成（任一触发即中断），`timedOut()` 区分「超时」与「主动取消」。
2. 按 format 分派 `callAnthropicMessages` / `callOpenAiChat` / `callOpenAiResponses`。
3. **重试策略（B-05）**：仅 5xx（502/503/504）与网络层失败（TypeError）重试一次、500ms 退避；4xx、超时、客户端取消不重试（防放大挂起）。
4. 超时 → `LlmCallError(408, '模型响应超时，请稍后重试')`。
5. 打点（B-06）：`llm_call` ok/retry/failed，含 providerId/format/mode/ms/status（网络层标记 NETWORK）。

## streamLlm：流式

- `anthropic_messages` / `openai_chat`：真流式（thinking/text 分片）。
- **`openai_responses` 未实现真流式**（B-04）：退化为整段 `callOpenAiResponses` 后一次性 yield——首 chunk 延迟=整个生成时长，**悬停早停对其无效**（选该格式的用户会等完整响应）。

## adapters/

### anthropicMessages.ts
- `resolveAnthropicMessagesUrl`：base 以 `/messages` 结尾原样；`/v1` 结尾 → `+/messages`；其余 → `+/v1/messages`（StepFun `step_plan` 根路径兼容）。
- `buildAnthropicBody`：system 拼接、thinking 块；**fast 模式带 `thinking:{type:'disabled'}`**（减少 CoT 泄漏与延迟；被拒 400/422 时回退一次不带该字段）。
- 流式解析：`content_block_start` / `content_block_delta`（text_delta/thinking_delta）；全程无分片 → 非流式回退；`callAnthropicMessages` 支持 images（base64/url）。
- 错误：`LlmCallError(status, 安全文案, { url, raw: slice(0,500) })`（A-01）。

### openaiChat.ts
- `resolveOpenAiChatUrl`：`/chat/completions` / `/v1` 后缀 / 含 `/v1` / 兜底 `+/v1/chat/completions`。
- 流式：`choices[0].delta.reasoning_content` → thinking、`content` → text；fast 模式附加 `enable_thinking:false`、`reasoning_effort:'none'`（兼容网关）。

### openaiResponses.ts
- `resolveOpenAiResponsesUrl` + `callOpenAiResponses`（非流式；仅当响应为 200 且 JSON 可解析时取 output_text；非 JSON body → `text:''`）。

## 错误处理契约

`LlmCallError(status, messageForClient, diagnostic {url, raw})`：客户端只见 `messageForClient`；`diagnostic` 只进日志。路由层 `llmError()` 把业务 AppError（`BYOK_URL_REJECTED`/`NO_PROVIDER`）原样透传，其余 → 502 `LLM_ERROR`（见 [Agent 体系总览](./overview.md)）。

## 聚焦测试（providers.test.ts）

- URL 解析三格式（根/v1/已带后缀/尾斜杠）。
- `extractAnthropicParts`：text/thinking 分离；无类型块不再回退正文（D-02）；completion/output_text 字符串兜底。
- 环境变量加载与模块缓存；generic 缺 baseUrl 被过滤。
- `byokToProvider`（缺字段 null、内网 URL 抛 `/本机|内网|元数据/`）；`resolveProvider` 优先级。
- **超时/重试**：5xx 重试一次后成功（2 次 fetch）；401 不重试（1 次 fetch）；TypeError 重试一次；超时 → 408 无重试、无敏感诊断字段。
- `callLlm` 各格式的 fetch 都收到合成 AbortSignal（超时可达上游）。

## 相关页面

- BYOK 保存/测试链路：[设置与 BYOK](../backend/settings-byok.md)
- 使用 Provider 的入口：[悬停 Agent](./hover-agent.md) / [面板对话](./chat-panel.md)
