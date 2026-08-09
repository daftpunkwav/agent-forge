---
type: 系统组件
title: 提示词工程与悬停净化（单一真相）
description: 五种提示词构造器、extractVisibleAnswer 门控、@agentforge/shared hoverSanitize 正则家族与卡片上限，前后端单一真相原则。
tags: [agent, prompts, sanitize, shared]
---

# 提示词与悬停净化

悬停答案的清洗/质检是**前后端共享的单一真相**：全部逻辑在 `packages/shared/src/hoverSanitize.ts`，`apps/api/src/lib/llm/agentPrompt.ts` 与前端缓存层只做 re-export/别名。设计原则（源码注释）：**所有正则只加不减（stricter OK, looser NOT OK）**；前端别名直接指向后端实现，消除双份副本漂移（C-04）。

## 提示词构造器（agentPrompt.ts）

| 构造器 | 用途 | 要点 |
|--------|------|------|
| `buildHoverSystem` | 悬停快讲 | 2–3 句完整中文陈述；**刻意少写「禁止…」清单**（模型易复述），用正例锚定格式（ReAct 示例句）；tone 按风格微调；记忆块只截 120 字 |
| `buildHoverRetrySystem` | 空答重试 | 极简「直接讲解…写两句完整中文陈述。不要自我提醒」 |
| `buildDeepSystem` | 面板/深度讲解 | 单轮结构化：`### Thought / ### Explain / ### Practice / ### Next`；硬性输出规则（禁写作计划/草稿/规则复述）；用户可见正文必须直接从四个标题开始 |
| `buildReactSystem` | ReAct tool-loop | `TOOL_CALL: {json}` 单行协议 + 两个工具清单 + 硬性规则（只使用列出的工具名、禁止编造 Observation、禁复述提示） |
| `styleInstruction` | 五风格 | professional / friendly / sassy / concise / socratic 各一段中文风格指令 |

`formatMemoryBlock(parts, {maxChars=800})`：route / mastered(≤12) / learning(≤12) / recentTopics(≤8) / notes(≤8)；无记录时写「暂无历史学习记录，按入门水平讲解」；总长上限 800 字（D-03）。

`AGENT_MODE_META`：fast（Fast Direct）/ deep（Deep Structured，D-05 明确「非真 tool-loop」）/ react（prompt-based tool-loop）——API `/meta` 与前端共用。

## extractVisibleAnswer（deep/chat 出口门控，A-04）

从「思考草稿 + 正文」拆出用户可见答案，统一出口做 **system 规则复述质检**：

1. 正文已有结构标题或 >40 字 → 优先正文（命中策划特征且思考非空 → `stripPlanningPreamble` 清理）。
2. 否则在 thinking 中找 `### Thought` 等标记，截取其后作为答案。
3. 去掉明显的策划前缀（`我需要|首先|结构|语气…` 起头且 >120 字 → 取最后一段）。
4. `isSystemEcho(answer)` → answer 置空（触发路由兜底文案）；`isSystemEcho(thinking)` → thinking 置空（不展示 prompt 内部措辞）。

## hoverSanitize 家族（packages/shared/src/hoverSanitize.ts）

**卡片硬上限**：`HOVER_CARD_MAX_SENTENCES = 3`、`HOVER_CARD_MAX_CHARS = 220`。

**检测正则（六族）**：

| 正则 | 拦截目标 |
|------|----------|
| `PLANNING_HINT` | 写作策划/内心独白前缀（`我需要：`、`结构如下`、`写作计划`、`检查清单`、`### Thought` 等） |
| `HOVER_META` | 悬停元叙述/系统提示复述（思考过程、内部独白、`语气：`、`Fast Direct` 等） |
| `SYSTEM_ECHO` | 模型复述 system「硬性输出规则」（只输出最终、禁止任何写作、自我检查、快讲助手…） |
| `TASK_ECHO` | 复述任务指令/格式口令（用户需要讲解、要 2~3 句、每句句号、只输出这两句…） |
| `SELF_REVISION` | 自我改稿/写作自检旁白（那调整下、没有元叙述、讲核心、一个类比…） |
| `SELF_TALK_PHRASE` | 可嵌在句中的写作旁白短语（还要提一下、讲清楚了、再顺一点…） |

**公共函数**：

- `stripSelfRevisionDraft(raw)`：按「调整下/最终版/重写如下」切稿，从后往前找第一段完整讲解（末稿常被 maxTokens 截断则回退上一版）。
- `isLikelyHoverTeaching(s)`：白名单式判断「可展示的纯讲解」（拒绝旁白/规则回声/问号占比过高/过短）。
- `finalizeHoverCardText(raw)`：最终卡片文案——原子单元过滤（句/行/bullet）→ 保留 ≤3 句完整陈述 → 220 字截断；**strip 清空后禁止 raw 回填**（纯指令句不得原样漏出）。
- `progressiveHoverAnswer` / `extractHoverAnswer`：流式/终稿统一出口（5 路候选 + 评分：多句优先、同句数取长）。
- `isCompleteHoverAnswer(s)`：缓存质量门（长度 12–260、无策划/回声/旁白/半截、句数 1–3、拒极短单句）——**宁可 miss 再请求，也不缓存半截答案二次毒害**。
- `isSystemEcho` / `looksLikeHoverPlanning`：deep/chat 共用门控（思考过程展示与悬停共用）。
- `isSafeHoverPublicAnswer`：对外质检（complete + 非策划 + 无问号 + ≤3 句 + ≤260 字 + teaching）——L2 缓存读写、hover 早停、前端 L1 全部走它。
- `sanitizeHoverDisplay`：展示用清洗（先剥改稿，再按句硬过滤）。
- 前端别名：`stripSelfRevisionClient` / `isSafeHoverDisplay` / `isLikelyHoverTeachingClient`（`hoverExplainCache.ts` re-export 兼容旧 import 路径）。

## 变更注意事项

- **改净化 = 前后端同时受影响**：`@agentforge/shared` 是两端共同依赖，改 DTO/常量/正则后必须 `npm run build --workspace=@agentforge/shared` 再构建两端。
- 新增拦截模式：只往正则里**加**项，不删；先在 `agentPrompt.hover.test.ts` 的命名用例里补回归样例再改代码。
- 缓存键版本：净化语义变化若影响悬停答案内容 → 升级 `HOVER_CACHE_KEY_VERSION`（当前 v7），旧键自然过期。

## 聚焦测试

- `agentPrompt.hover.test.ts`：12 个命名用例（bug1 改稿、bug2 自问拒绝、bug3 系统回声、bug4 任务回声、shot 格式元前缀/纯元信息/示例开头/截断尾、good-llm/good-cot、mixed-revision-then-clean），各断言 pass/dirtyPass/extracted/leak/missing。
- `packages/shared/src/smoke.test.ts`：can() 分级冒烟 + `isSafeHoverPublicAnswer`/`looksLikeHoverPlanning` 冒烟。
- 集成：`agent.sse.test.ts`（悬停无 thinking 下发、deep thinking 过滤）。

## 相关页面

- 使用方：[悬停 Agent](./hover-agent.md) / [面板对话](./chat-panel.md) / [packages/shared](../packages/shared.md)
