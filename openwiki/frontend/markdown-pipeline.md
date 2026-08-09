---
type: 前端功能
title: Markdown 管线（渲染、消毒、标注与嵌入）
description: marked + DOMPurify 白名单、preprocessAgentMarkup 作者标注、injectHeadingIds TOC、splitMarkdownWithAnimations 与 MarkdownView 渲染边界。
tags: [frontend, markdown, sanitize, xss]
---

# Markdown 管线

读者/作者内容与 LLM 输出统一走 `apps/web/src/lib/markdown.ts`：`marked`（GFM + breaks）渲染 + `DOMPurify` 白名单消毒 + 作者标注预处理 + 动画围栏拆分。**当前 markdown 来源为 LLM 输出（经服务端净化）与作者文章（可信内容）**；若未来开放渲染批注/评论的 LLM 输出，应收紧配置（注释建议 `FORBID_ATTR: ['id','class']`，仅保留 `data-agent-*`）。

## 渲染链（renderMarkdown）

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart LR
    MD["markdown 原文"] --> PRE["preprocessAgentMarkup<br/>代码块外替换标注"]
    PRE --> MK["marked.parse (GFM, breaks)"]
    MK --> DP["DOMPurify.sanitize<br/>ADD_ATTR 白名单"]
    DP --> OUT["HTML"]
    OUT --> MV["MarkdownView.tsx<br/>dangerouslySetInnerHTML"]
```

- **DOMPurify 白名单**（ADD_ATTR）：`id, target, rel, class, data-agent-topic, data-agent-term, data-agent-text, data-agent-hint, data-agent-zone`。
- **target/rel hook**（模块加载注册一次）：`target` 非 `_blank` 删除；有 target 一律补 `rel="noopener noreferrer"`（C-11）。

## 作者标注预处理（preprocessAgentMarkup）

**先按围栏代码块分段**（``` 内示例文本不替换，避免语法说明里的 `[[术语]]` 被误处理），再在非代码段执行：

| 语法 | 产物 | 悬停输入 |
|------|------|----------|
| `[[术语]]` | `<span class="agent-term" data-agent-topic data-agent-term="术语" data-agent-text="术语">` | 术语名 |
| `[[术语|提示]]` | 同上 + `data-agent-hint="提示"`，data-agent-text = `术语：提示` | 术语 + 提示 |
| `![alt](url){agent="hint"}`（或 `{agent=hint}`、`{agent='hint'}`） | `<img class="agent-term-img" data-agent-topic data-agent-term="alt" data-agent-text="hint" data-agent-hint="hint">` | 提示（缺省 alt） |

所有属性值先 `escapeHtml`（& < > "）。产出元素即 `hoverTarget.ts` 的目标（见 [Agent UI](./agent-ui.md)）。

## 动画嵌入拆分（splitMarkdownWithAnimations）

正则 `:::animation{id=["']?([^"'}\s]+)["']?\s*:::` 把 md 拆成 `{type:'md'|'animation', content|id}` 片段数组，供 ArticleBody 穿插渲染（见 [动画引擎](./animation-system.md)）。

## TOC 标题 id（injectHeadingIds）

为 h2/h3 注入 `id="section-{序号}-{slugified text}"`：**已有 `id` 属性的标题跳过**（`/\sid=/` 检测），slug 生成规则 = 去标签取纯文本 → **小写化 → 非单词/非汉字字符折叠为 `-` → 去掉首尾 `-` → 截 40 字**（CJK 感知）；`start` 序号跨片段递增（ArticleBody 跨 md 块调用，保证同标题不同块 id 唯一）。TableOfContents 据此查询 `.article-prose` 的 h2/h3（未带 id 时自行回退生成）并用 IntersectionObserver 跟踪。

## 渲染边界组件

**`components/agent/MarkdownView.tsx`** 是唯一执行 `renderMarkdown() → dangerouslySetInnerHTML` 的组件（类 `.agent-md` / `.agent-md-compact`），AgentFloat 气泡与 ArticleCardInlineAgent 卡片共用——**LLM 输出注入浏览器的单一安全边界**，改动消毒白名单时以此组件为验收点。

## 聚焦测试

无前端单测；消毒行为依据 `lib/markdown.ts` 源码与 C-11 注释；XSS 面核对见 `docs/security.md`（Markdown 消毒条目）。

## 相关页面

- 消费方：[页面清单](./pages.md)（ArticleBody/ArticleEditorPage）· [Agent UI](./agent-ui.md)
- 后端对应：[内容域](../backend/content.md)
