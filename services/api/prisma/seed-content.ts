/** 种子文章与动画步骤 — 长文内容 */

export interface SeedArticle {
  slug: string;
  title: string;
  summary: string;
  category: string;
  level: string;
  tags: string[];
  readMinutes: number;
  template: string;
  animationId: string;
  animationName: string;
  steps: { label: string; desc?: string; type?: string }[];
  markdown: string;
}

function embed(animId: string) {
  return `\n\n:::animation{id="${animId}"}\n:::\n\n`;
}

const reactSteps = [
  { label: '用户提问', type: 'input', desc: '需要查资料并计算的任务进入 Agent' },
  { label: 'Thought 1', type: 'thought', desc: '分析问题，决定先搜索事实' },
  { label: 'Action: 搜索', type: 'action', desc: '调用 search 工具' },
  { label: 'Observation', type: 'observation', desc: '返回检索摘要' },
  { label: 'Thought 2', type: 'thought', desc: '需要数值计算' },
  { label: 'Action: 计算', type: 'action', desc: '调用 calculator' },
  { label: 'Observation', type: 'observation', desc: '得到中间结果' },
  { label: 'Thought 3', type: 'thought', desc: '综合推理' },
  { label: 'Answer', type: 'answer', desc: '输出最终答案' },
];

export const DEFAULT_ARTICLE_SEEDS: SeedArticle[] = [
  {
    slug: 'react',
    title: 'ReAct：推理与行动的交替循环',
    summary:
      'ReAct（Reason + Act）是 Agent 最核心的推理模式之一。本文将用交互动画说明 Thought / Action / Observation 如何交替推进，并给出工程落地建议。',
    category: '推理模式',
    level: '入门',
    tags: ['ReAct', 'Agent', 'Tool Use'],
    readMinutes: 14,
    template: 'react',
    animationId: 'seed-anim-react',
    animationName: 'ReAct 循环演示',
    steps: reactSteps,
    markdown: `## 什么是 ReAct？

ReAct 由 Google Research 与 Princeton 在 2022 年提出（论文 *ReAct: Synergizing Reasoning and Acting in Language Models*）。核心思想非常直接：**让模型交替进行显式推理（Reasoning）与可执行行动（Acting）**，而不是像纯 Chain-of-Thought 那样只在文本里「想完再答」。

在真实 Agent 场景中，任务很少能靠一次生成解决。你需要查文档、调 API、读文件、跑测试——每一步都会产生新信息。ReAct 把这种人类式「想一步、做一步、看结果、再想」的过程结构化为可重复的循环。

> **核心洞察：** 把推理过程与外部行动交织，使每一步思考都能建立在真实观察（Observation）之上，从而显著提高复杂任务的可完成率与可解释性。

## 交互式动画演示

下面的动画展示了一个完整的 ReAct 循环。请使用播放 / 暂停 / 单步前进与后退，观察 Thought → Action → Observation 如何交替出现。

${embed('seed-anim-react')}

## 三元组：Thought · Action · Observation

### Thought（思考）

在每一步，Agent **先**用自然语言写出当前判断：目标是什么、已知什么、缺什么、下一步该用哪个工具。Thought 是**显式的**——它会出现在轨迹（trajectory）里，便于调试与评估。

好的 Thought 不是空话「我需要认真思考」，而是：

- 点名信息缺口（例如「还不知道 2024 奥运金牌数」）
- 选择行动类型与理由（「应用搜索而不是瞎猜」）
- 在拿到 Observation 后做校验（「结果是否足以回答」）

### Action（行动）

Action 是对工具或环境的调用，通常包含 **名称 + 参数**。在实现上对应 function calling / tool schema。关键点：

- 工具描述必须清晰，否则模型会选错工具
- 参数要可校验（JSON Schema），失败应返回可读错误
- 高风险工具（写库、发邮件、支付）应放在 Harness 闸门之后

### Observation（观察）

工具返回的结果写入上下文，成为下一步 Thought 的输入。Observation 过长会挤爆上下文窗口，因此工程上几乎总是需要：**截断、摘要、结构化字段提取**。

## 与 CoT 的对比

| 维度 | CoT | ReAct |
|------|-----|-------|
| 推理形态 | 纯文本中间步骤 | 推理与行动交织 |
| 外部信息 | 默认不接触环境 | 通过工具获取 |
| 幻觉风险 | 对事实题更高 | 可用检索降低 |
| 适用场景 | 数学、逻辑、封闭推理 | 开放世界、多工具任务 |
| 轨迹价值 | 便于看推理链 | 便于审计「做了什么」 |

ReAct 并不是 CoT 的替代品：许多系统在 **Thought 内部**仍使用 CoT 式分解，同时用 Action 对接工具。你也可以把 ReAct 看成「带工具的 CoT」。

## 代码示例（概念）

以下示例展示 ReAct 风格轨迹（伪代码，框架 API 会随版本变化）：

\`\`\`python
# 伪代码：ReAct 风格循环
while steps < max_steps:
    thought = llm.generate(context + "\\nThought:")
    action = parse_action(llm.generate(context + thought + "\\nAction:"))
    if action.name == "Final Answer":
        return action.args
    observation = tools.run(action.name, action.args)
    context += thought + action + observation
\`\`\`

在 LangChain / LlamaIndex / 自研 runtime 中，上述循环往往由 AgentExecutor 或状态机封装，但**语义层仍是 ReAct**。

## 工程最佳实践

1. **限制最大步数与总 token 预算**，防止死循环与费用爆炸。
2. **工具返回可机器解析**，同时给模型一段短自然语言摘要。
3. **在 System Prompt 中给 1–2 个 ReAct few-shot 示例**，稳定输出格式。
4. **失败可恢复**：工具超时、4xx/5xx 应变成 Observation，而不是直接崩溃。
5. **记录完整轨迹**用于评估（成功率、工具命中率、平均步数）。
6. **与 Harness 结合**：权限、超时、人工确认属于外层约束，不要只靠模型自觉。

## 常见误区

- **误区一：把 ReAct 当成提示词咒语。** 没有可靠工具与运行时，只写 “Think step by step and act” 帮助有限。
- **误区二：Observation 原样塞进上下文。** HTML 整页、巨型 JSON 会迅速耗尽窗口。
- **误区三：不允许模型「认输」。** 应允许 Final Answer 为「信息不足 + 已尝试步骤」。

## 延伸阅读

- [论文] ReAct: Synergizing Reasoning and Acting in Language Models (arXiv:2210.03629)
- 站内： [CoT 思维链](/knowledge/cot) · [工具调用](/knowledge/tool-use) · [Agent Loop](/knowledge/loop)
`,
  },
  {
    slug: 'cot',
    title: 'CoT 思维链：让模型把推理写出来',
    summary: 'Chain-of-Thought 通过显式中间步骤提升复杂推理表现，是理解更高级模式（ToT/GoT/ReAct）的基础。',
    category: '推理模式',
    level: '入门',
    tags: ['CoT', 'Reasoning'],
    readMinutes: 12,
    template: 'cot',
    animationId: 'seed-anim-cot',
    animationName: 'CoT 逐步推理',
    steps: [
      { label: '问题', type: 'input', desc: '输入复杂问题' },
      { label: '分解', type: 'step', desc: '拆成子问题' },
      { label: '推导', type: 'step', desc: '逐步计算或论证' },
      { label: '校验', type: 'step', desc: '检查中间结论' },
      { label: '答案', type: 'answer', desc: '汇总最终结果' },
    ],
    markdown: `## 思维链是什么？

Chain-of-Thought（CoT）指：**要求模型在给出最终答案前，生成一系列中间推理步骤**。Wei 等人的工作表明，对足够大的模型，简单的提示（如 “Let’s think step by step”）就能在数学、常识与符号推理基准上带来显著提升。

为什么有效？一种直观解释是：自回归模型一次只预测下一个 token；把难题拆成短步骤，等于把「很难的条件概率」变成「多个较容易的条件概率」连乘。另一些研究从「计算深度」角度理解：更多生成 token 提供了更多内部计算步。

## 动画：步骤如何展开

${embed('seed-anim-cot')}

## 常见形式

### Zero-shot CoT

不给示例，只加一句触发语：「请一步步思考」。实现成本最低，适合快速试验。

### Few-shot CoT

提供若干「题目 → 推理链 → 答案」示范。示范质量强烈影响格式与严谨程度。注意示范中的错误会被模仿。

### Self-Consistency

对同一问题采样多条推理链，再对答案投票。以计算换稳定性，常用于数学题。

### 结构化 CoT

用编号列表、JSON 字段（\`reasoning\` / \`answer\`）约束输出，便于程序解析与评估。

## 与 Agent 的关系

纯 CoT **不调用工具**，因此对需要最新事实或私有数据的任务力不从心。但在 Agent 内部，几乎每个 Thought 都可以是一段 mini-CoT。更复杂的 ToT / GoT 可视为在搜索结构上扩展了 CoT。

## 实践建议

1. **答案与推理分离**：便于自动评分只比对最终答案。  
2. **控制长度**：过长链浪费 token，且可能引入无关枝节。  
3. **对关键计算用工具**：心算易错，计算器更稳（这就走向 ReAct）。  
4. **评估时同时看过程与结果**：过程对、结果错 vs 结果对、过程胡编，治理策略不同。

## 延伸阅读

- Wei et al., Chain-of-Thought Prompting Elicits Reasoning in Large Language Models  
- 站内：[ToT](/knowledge/tot) · [ReAct](/knowledge/react)
`,
  },
  {
    slug: 'tot',
    title: 'ToT 思维树：在推理空间里搜索',
    summary: 'Tree of Thoughts 把推理组织成树：生成多候选、评估、剪枝、扩展，适合规划与谜题类任务。',
    category: '推理模式',
    level: '中级',
    tags: ['ToT', 'Search'],
    readMinutes: 13,
    template: 'tot',
    animationId: 'seed-anim-tot',
    animationName: 'ToT 搜索演示',
    steps: [
      { label: '根问题', type: 'root', desc: '定义目标状态' },
      { label: '分支 A/B/C', type: 'branch', desc: '并发生成候选思路' },
      { label: '评估打分', type: 'eval', desc: '启发式或模型自评' },
      { label: '剪枝', type: 'prune', desc: '丢弃低分路径' },
      { label: '扩展', type: 'expand', desc: '沿高分节点继续' },
      { label: '最优解', type: 'answer', desc: '回溯得到方案' },
    ],
    markdown: `## 从链到树

CoT 是一条链：每一步只有一个后继。Tree of Thoughts（ToT）允许在每层生成**多个候选想法**，用评估器打分，再选择扩展哪些节点。这把「提示工程」部分地升级为「在推理状态空间上做搜索」。

典型组件：

1. **思想生成器**：从当前节点采样 k 个下一步  
2. **状态评估器**：启发式分数或另一 LLM 投票  
3. **搜索算法**：BFS / DFS / beam search  
4. **终止条件**：达到答案格式或深度上限  

## 动画

${embed('seed-anim-tot')}

## 何时使用 ToT

- 需要探索多种计划（旅行规划、系统设计草案）  
- 谜题、游戏、多约束排程  
- 单链 CoT 容易「一条道走到黑」的任务  

成本方面：ToT 的 token 与延迟通常数倍于 CoT，必须设宽度、深度与预算。生产中常只在「规划阶段」用 ToT，执行阶段改用 ReAct。

## 实现要点

- **状态表示要可比较**：纯散文难剪枝，可用结构化字段  
- **评估器校准**：自评过乐观时，加入规则校验或单元测试  
- **缓存公共前缀**：避免重复计算相同前缀路径  

## 延伸阅读

- Yao et al., Tree of Thoughts  
- 站内：[GoT](/knowledge/got) · [Harness](/knowledge/harness)
`,
  },
  {
    slug: 'got',
    title: 'GoT 图谱思维：用图表达推理依赖',
    summary: 'Graph of Thoughts 将中间想法建模为图节点，支持聚合、精炼与任意依赖，而不仅是链或树。',
    category: '推理模式',
    level: '中级',
    tags: ['GoT', 'Graph'],
    readMinutes: 12,
    template: 'got',
    animationId: 'seed-anim-got',
    animationName: 'GoT 图构建',
    steps: [
      { label: '创建节点', type: 'node', desc: '想法成为节点' },
      { label: '建立边', type: 'edge', desc: '依赖与支持关系' },
      { label: '聚合', type: 'aggregate', desc: '合并子结果' },
      { label: '精炼', type: 'refine', desc: '修正冲突' },
      { label: '输出', type: 'answer', desc: '从图抽取答案' },
    ],
    markdown: `## 为什么需要图？

链只有线性依赖，树允许分叉但不方便「合并两条支路的结论」。Graph of Thoughts（GoT）把中间思想作为**图节点**，边表示依赖、细化或聚合关系。于是你可以：

- 把子任务结果 **aggregate** 成更高层摘要  
- 对节点 **refine** 而不丢掉兄弟节点  
- 表达比树更一般的依赖（DAG 甚至带受控环的工作流）

## 动画

${embed('seed-anim-got')}

## 与 ToT / CoT 的定位

| 结构 | 表达力 | 成本 | 典型用途 |
|------|--------|------|----------|
| CoT 链 | 低 | 低 | 单路径推理 |
| ToT 树 | 中 | 中高 | 搜索多方案 |
| GoT 图 | 高 | 高 | 分解-汇总、多源综合 |

## 工程提示

图结构要有**显式 schema**（节点 id、类型、内容、分数），不要只存在于自由文本。执行层可用状态机或工作流引擎保存图，模型只负责提出「加边/加节点」操作。

## 延伸阅读

- Besta et al., Graph of Thoughts  
- 站内：[ToT](/knowledge/tot) · [上下文管理](/knowledge/context)
`,
  },
  {
    slug: 'mcp',
    title: 'MCP：模型上下文协议',
    summary: 'Model Context Protocol 定义 LLM 应用与外部工具/资源之间的标准连接方式，是 Agent 集成的基础设施。',
    category: '协议',
    level: '中级',
    tags: ['MCP', 'Protocol', 'Tools'],
    readMinutes: 15,
    template: 'mcp',
    animationId: 'seed-anim-mcp',
    animationName: 'MCP 通信流程',
    steps: [
      { label: '建立连接', type: 'connect', desc: 'Client 连接 Server' },
      { label: 'tools/list', type: 'list', desc: '发现可用工具' },
      { label: 'tools/call', type: 'call', desc: '调用具体工具' },
      { label: 'resources', type: 'resource', desc: '读取资源' },
      { label: '结果返回', type: 'result', desc: '结构化结果回传' },
    ],
    markdown: `## MCP 解决什么问题？

在 MCP 出现前，每个 AI 应用用私有插件格式对接工具：Chat 应用一套、IDE 一套、Agent 框架又一套。**Model Context Protocol（MCP）** 试图提供通用协议，让「模型宿主（Host/Client）」与「能力提供者（Server）」解耦。

你可以把它类比成 **AI 版的 LSP（语言服务器协议）**：编辑器不必为每个语言重写插件逻辑，只要对话统一协议。

## 核心角色

- **Host**：用户面对的应用（桌面助手、IDE、Agent 运行时）  
- **Client**：Host 内的协议客户端  
- **Server**：暴露 tools / resources / prompts 的进程或远端服务  

## 动画：一次典型会话

${embed('seed-anim-mcp')}

## 能力面

1. **Tools**：可调用函数（带 JSON Schema）  
2. **Resources**：可读的数据句柄（文件、票据、知识库文档）  
3. **Prompts**：可复用的提示模板（可选）  

传输上常见 stdio（本地进程）与 HTTP/SSE（远端）。安全上必须考虑：服务器权限最小化、用户确认、密钥不进日志。

## 与 Agent 开发的关系

Agent 的「工具层」可以全部变成 MCP Server：浏览器、数据库、内部 API 网关。模型侧只看到统一的 tools/list 与 tools/call。这降低了换模型/换 Host 的成本，也方便组织内共享同一组企业工具。

## 实践清单

- 为每个 tool 写清 **何时用 / 何时不用**  
- 返回结构稳定，错误用 isError 标记  
- 大资源用分页或摘要，避免一次 dump  
- 本地 Server 的文件系统范围要沙箱化  

## 延伸阅读

- 官方 MCP 规范与示例仓库  
- 站内：[工具调用](/knowledge/tool-use) · [Harness](/knowledge/harness)
`,
  },
  {
    slug: 'context',
    title: '上下文管理：在有限窗口里放对信息',
    summary: 'Context 是 Agent 的工作台。组装、压缩、截断与缓存策略直接决定能力上限与成本。',
    category: '工程实践',
    level: '中级',
    tags: ['Context', 'Compression'],
    readMinutes: 14,
    template: 'loop',
    animationId: 'seed-anim-context',
    animationName: '上下文构建过程',
    steps: [
      { label: 'System', type: 'sense', desc: '角色与规则' },
      { label: '工具定义', type: 'plan', desc: 'schema 进上下文' },
      { label: '历史消息', type: 'act', desc: '对话轨迹' },
      { label: '检索片段', type: 'observe', desc: 'RAG 结果' },
      { label: '压缩', type: 'context', desc: '摘要旧轮次' },
      { label: '发送', type: 'stop', desc: '组装完整 prompt' },
    ],
    markdown: `## Context Window 是硬约束

模型一次能「看见」的 token 数有限。Agent 却持续产生：系统提示、工具 schema、历史、Observation、检索文档……**上下文管理**的本质是：在有限桌面上始终摆放最相关的信息。

## 动画：组装过程

${embed('seed-anim-context')}

## 常见组成

1. System / Developer 指令  
2. 工具与输出格式约定  
3. 长期记忆检索结果  
4. 对话与工具轨迹  
5. 当前用户消息  

## 策略工具箱

### 滑动窗口

只保留最近 N 轮。实现简单，但会丢掉早期约束（例如用户一开始说的「我过敏」）。

### 摘要压缩

用模型把旧对话压成摘要，保留近期原文。注意摘要本身会丢细节与引入错误，重要事实应结构化存储。

### 分层记忆

热数据在窗口内，温数据在会话摘要，冷数据在向量库/数据库，按需召回。

### 工具结果治理

原始 payload 存对象存储，上下文只放 **引用 id + 短摘要 + 关键字段**。

## 与成本、延迟的关系

同样任务，乱塞检索 top-20 全文可能比「精排 top-3 + 摘要」贵数倍且更慢。评估时应同时看 **任务成功率与平均输入 token**。

## 延伸阅读

- 站内：[记忆系统](/knowledge/memory) · [Agent Loop](/knowledge/loop)
`,
  },
  {
    slug: 'loop',
    title: 'Agent Loop 工程：把智能放进可控循环',
    summary: 'Agent 的运行时核心是循环：感知、规划、行动、观察、更新状态，直到停机条件。',
    category: '工程实践',
    level: '中级',
    tags: ['Loop', 'Runtime'],
    readMinutes: 13,
    template: 'loop',
    animationId: 'seed-anim-loop',
    animationName: 'Agent Loop',
    steps: [
      { label: '感知', type: 'sense', desc: '输入与状态' },
      { label: '规划', type: 'plan', desc: '下一步意图' },
      { label: '行动', type: 'act', desc: '工具或回复' },
      { label: '观察', type: 'observe', desc: '环境反馈' },
      { label: '更新', type: 'context', desc: '写记忆/状态' },
      { label: '停机?', type: 'stop', desc: '完成或继续' },
    ],
    markdown: `## Loop 是 Agent 的心跳

无论外面包的是 ReAct 提示还是图工作流，运行时几乎都是一个 **while** 循环。Loop Engineering 关注的不是「模型聪不聪明」，而是：

- 何时进入下一步  
- 状态存在哪  
- 失败如何重试  
- 何时强制停止  
- 如何观测每一次迭代  

## 动画

${embed('seed-anim-loop')}

## 最小状态机

\`\`\`text
IDLE → PLAN → ACT → OBSERVE → UPDATE → (PLAN | DONE | FAILED)
\`\`\`

在代码里可用显式状态枚举，避免「巨型 if-else + 字符串协议」失控。

## 关键工程点

1. **幂等工具调用**：网络重试不要造成重复下单  
2. **步数与墙钟超时**：双保险  
3. **可恢复检查点**：长任务中断后可续跑  
4. **人机回环节点**：支付、删除、外发必须可插入  
5. **结构化日志**：step id、tool name、latency、token  

## 与 Harness 的边界

Loop 描述「怎么转」；Harness 描述「转的时候被什么笼子关着」。两者应分开实现，便于复用同一 Loop 换不同策略。

## 延伸阅读

- 站内：[Harness](/knowledge/harness) · [评估系统](/knowledge/evaluation)
`,
  },
  {
    slug: 'harness',
    title: 'Harness 工程：给 Agent 装上缰绳',
    summary: 'Harness 是策略、权限、预算、闸门与可观测性的集合，把 demo Agent 变成可上线系统。',
    category: '工程实践',
    level: '高级',
    tags: ['Harness', 'Safety', 'Ops'],
    readMinutes: 14,
    template: 'harness',
    animationId: 'seed-anim-harness',
    animationName: 'Harness 约束流',
    steps: [
      { label: '目标与成功标准', type: 'goal', desc: '定义完成条件' },
      { label: '策略约束', type: 'policy', desc: '权限与预算' },
      { label: '工具白名单', type: 'tools', desc: '能力边界' },
      { label: '受控运行', type: 'run', desc: 'Loop 在笼中执行' },
      { label: '观测评估', type: 'eval', desc: '指标与轨迹' },
      { label: '人工闸门', type: 'gate', desc: '高风险确认' },
    ],
    markdown: `## 从「能跑」到「敢上线」

许多 Agent 演示在沙箱里表现惊艳，一到生产就翻车：乱调 API、循环烧钱、泄露数据。**Harness（挽具/线束）** 一词在工程社区被用来描述那套 **约束与编排外壳**：模型仍然负责智能，外壳负责安全与稳定。

## 动画

${embed('seed-anim-harness')}

## Harness 通常包含什么？

1. **策略（Policy）**：哪些工具、哪些资源、哪些用户  
2. **预算（Budget）**：token、金额、步数、并发  
3. **闸门（Gate）**：人工审批、二次确认  
4. **沙箱（Sandbox）**：文件系统、网络出口限制  
5. **观测（Observability）**：轨迹、指标、告警  
6. **评估钩子（Eval hooks）**：上线前回归、线上抽样  

## 设计原则

- **默认拒绝，显式允许**  
- **能力与身份绑定**（这个用户的 Agent 不能用那个管理员工具）  
- **可测试**：把 policy 写成数据，而不是散落 if  
- **与模型提示分离**：安全边界不能只写在 system prompt  

## 最小落地路径

先为写操作加闸门与审计日志，再为所有工具加超时与重试策略，最后补预算与回归集。不要一上来造「万能策略引擎」。

## 延伸阅读

- 站内：[Agent Loop](/knowledge/loop) · [评估系统](/knowledge/evaluation) · [工具调用](/knowledge/tool-use)
`,
  },
  {
    slug: 'memory',
    title: '记忆系统：让 Agent 记得该记的',
    summary: '短期、工作与长期记忆如何分层设计，以及写入、检索、遗忘策略。',
    category: '工程实践',
    level: '中级',
    tags: ['Memory', 'RAG'],
    readMinutes: 13,
    template: 'memory',
    animationId: 'seed-anim-memory',
    animationName: '记忆层次',
    steps: [
      { label: '短期记忆', type: 'short', desc: '窗口内对话' },
      { label: '工作记忆', type: 'working', desc: '任务状态' },
      { label: '写入长期', type: 'write', desc: '摘要/向量入库' },
      { label: '检索', type: 'retrieve', desc: '相关记忆召回' },
      { label: '注入', type: 'inject', desc: '进入当前上下文' },
    ],
    markdown: `## 为什么需要记忆？

无状态对话每次都从零开始；Agent 却要跨会话记住偏好、项目约定与已验证事实。记忆系统把「模型权重里的知识」与「用户与任务特有知识」分开。

## 动画

${embed('seed-anim-memory')}

## 三层模型

### 短期（Short-term）

就是上下文窗口中的近期消息与工具结果。受 token 限制，需截断与摘要。

### 工作记忆（Working）

当前任务的结构化状态：清单、变量、子目标。适合放在数据库或状态机，而不是全靠自然语言。

### 长期（Long-term）

跨会话保留：向量检索、知识图谱、键值 preference。写入要克制，避免把噪声当记忆。

## 写入策略

- **显式**：用户说「记住这个」  
- **隐式**：对话结束时抽取事实  
- **事件驱动**：工具成功后写入业务实体  

每条记忆应带 **时间戳、来源、置信度、作用域（用户/项目）**。

## 遗忘与冲突

新事实覆盖旧事实需要合并策略；过期 token、已撤销权限必须失效。记忆不是越大越好。

## 延伸阅读

- 站内：[上下文管理](/knowledge/context) · [评估系统](/knowledge/evaluation)
`,
  },
  {
    slug: 'evaluation',
    title: '评估系统：如何知道 Agent 变好了',
    summary: '离线基准、模拟用户、线上指标与轨迹分析，构成 Agent 迭代的反馈闭环。',
    category: '工程实践',
    level: '中级',
    tags: ['Eval', 'Metrics'],
    readMinutes: 12,
    template: 'loop',
    animationId: 'seed-anim-eval',
    animationName: '评估闭环',
    steps: [
      { label: '定义任务集', type: 'plan', desc: '用例与期望' },
      { label: '运行 Agent', type: 'act', desc: '批量回放' },
      { label: '自动打分', type: 'observe', desc: '规则/模型评判' },
      { label: '人工抽检', type: 'gate', desc: '校准自动分' },
      { label: '回归门禁', type: 'stop', desc: '决定是否发布' },
    ],
    markdown: `## 没有评估就没有工程

模型版本、提示词、工具、检索策略任一变化都可能让 Agent 变差。评估系统回答两个问题：**现在有多好？这次改动有没有变差？**

## 动画：评估闭环

${embed('seed-anim-eval')}

## 指标分层

1. **任务成功**：是否完成用户目标  
2. **过程质量**：步数、工具错误率、循环次数  
3. **成本**：token、延迟、美元  
4. **安全**：越权尝试、有害输出率  
5. **体验**：人工偏好、点踩  

## 方法

- **黄金集**：手写输入 + 期望输出/rubric  
- **LLM-as-Judge**：注意偏见与位置效应，需抽检  
- **模拟用户**：多轮对话脚本  
- **线上影子流量**：新策略只观察不生效  

## 实践建议

把评估接入 CI：提示词或工具 schema 变更必须跑最小回归。为 flaky 用例打标，避免噪声阻塞发布。

## 延伸阅读

- 站内：[Harness](/knowledge/harness) · [Agent Loop](/knowledge/loop)
`,
  },
  {
    slug: 'tool-use',
    title: '工具调用：从意图到 Observation',
    summary: 'Tool Calling 的全链路：选择、参数、执行、错误处理与安全，是 ReAct Agent 的手脚。',
    category: '工程实践',
    level: '入门',
    tags: ['Tools', 'Function Calling'],
    readMinutes: 13,
    template: 'tool',
    animationId: 'seed-anim-tool',
    animationName: '工具调用流程',
    steps: [
      { label: '意图', type: 'intent', desc: '是否需要工具' },
      { label: '选择', type: 'select', desc: '匹配 schema' },
      { label: '参数', type: 'args', desc: 'JSON 校验' },
      { label: '执行', type: 'exec', desc: '调用实现' },
      { label: '解析', type: 'parse', desc: '错误与截断' },
      { label: '继续', type: 'continue', desc: '写回上下文' },
    ],
    markdown: `## 工具是 Agent 的效应器

没有工具，模型只能聊天；有了工具，模型才能改系统状态、读实时数据。现代 API 提供 **function calling / tool use**，把 JSON 参数与模型输出对齐。

## 动画

${embed('seed-anim-tool')}

## 设计好用的工具

1. **单一职责**：一个 tool 做一件事  
2. **描述面向决策**：说明适用场景与反例  
3. **参数少而明确**：枚举优于自由字符串  
4. **返回可预测**：稳定字段名  
5. **错误可行动**：告诉模型如何改参数重试  

## 安全

- 鉴权在服务端，不在提示词  
- 危险操作二次确认  
- 速率限制与审计  
- 防止提示注入通过网页内容驱动乱调工具  

## 延伸阅读

- 站内：[ReAct](/knowledge/react) · [MCP](/knowledge/mcp)
`,
  },
  {
    slug: 'prompt-eng',
    title: 'Prompt 工程：给 Agent 写说明书',
    summary: '系统提示、模式库、输出契约与迭代方法，是 Agent 行为的第一控制面。',
    category: '工程实践',
    level: '入门',
    tags: ['Prompt', 'System'],
    readMinutes: 12,
    template: 'cot',
    animationId: 'seed-anim-prompt',
    animationName: '提示结构',
    steps: [
      { label: '角色', type: 'step', desc: '你是谁' },
      { label: '目标', type: 'step', desc: '要完成什么' },
      { label: '约束', type: 'step', desc: '不能做什么' },
      { label: '工具说明', type: 'step', desc: '如何行动' },
      { label: '输出格式', type: 'answer', desc: '契约' },
    ],
    markdown: `## Prompt 仍是核心控制面

即使有微调与工具，**系统提示**依然决定默认行为：语气、安全边界、何时调用工具、如何承认不知道。Prompt 工程不是「玄学咒语」，而是编写**可测试的说明书**。

## 动画：提示分层

${embed('seed-anim-prompt')}

## 推荐结构

1. 角色与受众  
2. 目标与成功标准  
3. 硬约束（合规、风格、语言）  
4. 工具使用策略  
5. 输出格式 / JSON schema  
6. 少样本（可选）  

## 迭代方法

准备 10–30 个固定用例，每次只改一处提示，看回归指标。把提示像代码一样做 code review 与版本管理。

## 延伸阅读

- 站内：[CoT](/knowledge/cot) · [评估系统](/knowledge/evaluation) · [LLM Prompting](/knowledge/prompting)
`,
  },
  {
    slug: 'frameworks-langchain',
    title: 'LangChain：编排 LLM 应用的瑞士军刀',
    summary: 'LCEL、Agent、LangGraph 与可观测性组件如何拼出生产级链路。',
    category: '框架',
    level: '中级',
    tags: ['LangChain', 'LangGraph'],
    readMinutes: 12,
    template: 'loop',
    animationId: 'seed-anim-langchain',
    animationName: '链与图编排',
    steps: [
      { label: '输入', type: 'sense', desc: '用户消息' },
      { label: '链/图节点', type: 'plan', desc: 'LCEL / Graph' },
      { label: '工具节点', type: 'act', desc: '绑定 tools' },
      { label: '状态更新', type: 'context', desc: 'checkpoint' },
      { label: '输出', type: 'stop', desc: '最终响应' },
    ],
    markdown: `## 定位

LangChain 提供模型抽象、提示模板、检索、工具与 Agent 编排。复杂控制流越来越多地走向 **LangGraph**（显式状态图）。适合希望快速拼装、生态集成多的团队。

## 动画

${embed('seed-anim-langchain')}

## 何时选它

- 需要大量现成集成（向量库、文档加载器）  
- 想用社区惯例快速搭 RAG + Agent  
- 能接受框架升级带来的 API 变动成本  

## 注意

抽象层厚时调试变难。生产中建议：**核心循环自己掌控**，框架负责适配器；并上 LangSmith 或 OpenTelemetry 做轨迹。

## 延伸阅读

- 官方文档 · 站内：[AutoGen](/knowledge/frameworks-autogen) · [CrewAI](/knowledge/frameworks-crewai)
`,
  },
  {
    slug: 'frameworks-autogen',
    title: 'AutoGen：多 Agent 对话式协作',
    summary: '微软开源的多 Agent 框架，通过 Agent 间消息传递完成分工与反思。',
    category: '框架',
    level: '中级',
    tags: ['AutoGen', 'Multi-Agent'],
    readMinutes: 11,
    template: 'loop',
    animationId: 'seed-anim-autogen',
    animationName: '多 Agent 对话',
    steps: [
      { label: 'UserProxy', type: 'sense', desc: '接收任务' },
      { label: 'Assistant', type: 'plan', desc: '提出方案' },
      { label: '执行/工具', type: 'act', desc: '写码或调用' },
      { label: '反馈', type: 'observe', desc: '互评与修正' },
      { label: '汇总', type: 'stop', desc: '交付结果' },
    ],
    markdown: `## 对话即协作

AutoGen 把协作建模为 **多个 Agent 互发消息**。常见模式：UserProxy + Assistant，或增加 Critic / Engineer 角色。适合代码生成、研究助理等需要「你来写我来审」的流程。

## 动画

${embed('seed-anim-autogen')}

## 优劣

- 优点：模式自然、扩展角色容易  
- 风险：对话轮次爆炸、成本与不确定性上升  

要用 **终止条件、最大轮次、工具白名单** 约束，否则会变成「两个模型闲聊」。

## 延伸阅读

- 站内：[CrewAI](/knowledge/frameworks-crewai) · [Harness](/knowledge/harness)
`,
  },
  {
    slug: 'frameworks-crewai',
    title: 'CrewAI：角色化团队编排',
    summary: '以角色、任务与流程组织多 Agent 团队，强调流程化分工。',
    category: '框架',
    level: '中级',
    tags: ['CrewAI', 'Roles'],
    readMinutes: 11,
    template: 'loop',
    animationId: 'seed-anim-crewai',
    animationName: 'Crew 任务流',
    steps: [
      { label: '定义角色', type: 'plan', desc: '研究员/写手…' },
      { label: '拆任务', type: 'sense', desc: 'Task 依赖' },
      { label: '顺序/层级执行', type: 'act', desc: 'Process' },
      { label: '产物交接', type: 'observe', desc: '上下文传递' },
      { label: '最终交付', type: 'stop', desc: '汇总输出' },
    ],
    markdown: `## 角色 + 任务 + 流程

CrewAI 用 **Agent（角色）**、**Task**、**Crew/Process** 描述团队。对内容流水线、调研报告、运营自动化等「像团队做事」的场景很直观。

## 动画

${embed('seed-anim-crewai')}

## 选型建议

若你的领域专家天然分工清晰，CrewAI 上手快；若需要细粒度状态机与人机回环，可能更偏好 LangGraph 或自研。无论哪种种框架，**评估与 Harness 都不可省**。

## 延伸阅读

- 站内：[LangChain](/knowledge/frameworks-langchain) · [评估系统](/knowledge/evaluation)
`,
  },
  {
    slug: 'llm-basics',
    title: 'LLM 基础概念：能力、边界与接口',
    summary: '从语言模型到 Chat / Tool 接口，建立 Agent 开发所需的最小认知模型。',
    category: 'LLM基础',
    level: '入门',
    tags: ['LLM', 'Basics'],
    readMinutes: 12,
    template: 'cot',
    animationId: 'seed-anim-llm-basics',
    animationName: '从输入到输出',
    steps: [
      { label: '文本输入', type: 'input', desc: 'prompt' },
      { label: '分词', type: 'step', desc: 'token 序列' },
      { label: '模型前向', type: 'step', desc: '预测分布' },
      { label: '采样', type: 'step', desc: '生成 token' },
      { label: '后处理', type: 'answer', desc: '解码文本/工具调用' },
    ],
    markdown: `## 语言模型在做什么？

大语言模型（LLM）在训练中学习「给定前文，下一个 token 的概率分布」。对话产品在此之上加了指令微调与对齐，使模型更听从人类请求。对 Agent 开发者，关键是理解：**它擅长模式补全与综合，不保证事实与权限正确**。

## 动画

${embed('seed-anim-llm-basics')}

## 能力与边界

- 强：总结、改写、代码草稿、格式转换、多步规划草稿  
- 弱：精确算术、最新事件、私有数据（除非工具/检索）、严格遵守未强化的规则  

因此 Agent 要把 **检索与工具** 作为一等公民，而不是幻想「更大模型就全会」。

## 接口形态

Chat Completions、Responses、流式输出、Tool calls、结构化输出（JSON mode / schema）——选型时优先保证 **可解析与可观测**。

## 延伸阅读

- 站内：[Transformer](/knowledge/transformers) · [Tokenization](/knowledge/tokenization)
`,
  },
  {
    slug: 'transformers',
    title: 'Transformer 架构速览',
    summary: '自注意力、位置信息与编解码结构，帮助你读懂模型规格与长度限制。',
    category: 'LLM基础',
    level: '入门',
    tags: ['Transformer', 'Attention'],
    readMinutes: 11,
    template: 'cot',
    animationId: 'seed-anim-transformers',
    animationName: '注意力聚合',
    steps: [
      { label: '嵌入', type: 'step', desc: 'token → 向量' },
      { label: '自注意力', type: 'step', desc: '聚合上下文' },
      { label: '前馈层', type: 'step', desc: '逐位置变换' },
      { label: '多层堆叠', type: 'step', desc: '加深表示' },
      { label: '输出logits', type: 'answer', desc: '词表分布' },
    ],
    markdown: `## 为什么处处都是 Transformer？

2017 年的 *Attention Is All You Need* 用自注意力替代循环，带来可并行训练与强大的长程依赖建模。今日主流 LLM 多为 **Decoder-only Transformer**。

## 动画（概念）

${embed('seed-anim-transformers')}

## 你需要记住的工程含义

- **上下文长度**受位置编码与训练方案限制  
- **KV cache** 影响推理显存与速度  
- **MoE / 量化**改变成本曲线但不改「token 预测」本质  

## 延伸阅读

- 原论文与哈佛 NLP 注解 The Annotated Transformer  
- 站内：[分词](/knowledge/tokenization)
`,
  },
  {
    slug: 'tokenization',
    title: '分词与 Token：成本与边界的计量单位',
    summary: 'BPE 等算法如何切分文本，为何中英 token 密度不同，以及对 Agent 成本估算的意义。',
    category: 'LLM基础',
    level: '入门',
    tags: ['Token', 'BPE'],
    readMinutes: 10,
    template: 'cot',
    animationId: 'seed-anim-token',
    animationName: '文本切分为 Token',
    steps: [
      { label: '原始文本', type: 'input', desc: '字符流' },
      { label: '词表匹配', type: 'step', desc: 'BPE/词表' },
      { label: 'token ids', type: 'step', desc: '整数序列' },
      { label: '计费与窗口', type: 'answer', desc: '按 token 计量' },
    ],
    markdown: `## Token 是 API 的货币

计费、速率与上下文窗口都以 token 计。同一段中文往往比英文占用更多 token（取决于词表）。Agent 若把巨型 Observation 直接塞回模型，账单与延迟会一起恶化。

## 动画

${embed('seed-anim-token')}

## 实践

- 用官方 tokenizer 做预算，不要用「字数/4」拍脑袋  
- 日志里记录 input/output tokens  
- 压缩策略以 token 为目标函数  

## 延伸阅读

- 站内：[上下文管理](/knowledge/context) · [微调](/knowledge/fine-tuning)
`,
  },
  {
    slug: 'fine-tuning',
    title: '微调：何时该训，何时不该训',
    summary: 'SFT、偏好对齐与 LoRA 等参数高效方法，以及与 RAG/工具的分工。',
    category: 'LLM基础',
    level: '中级',
    tags: ['SFT', 'LoRA'],
    readMinutes: 12,
    template: 'cot',
    animationId: 'seed-anim-ft',
    animationName: '微调数据流',
    steps: [
      { label: '任务定义', type: 'step', desc: '要改什么行为' },
      { label: '数据构建', type: 'step', desc: '高质量样本' },
      { label: '训练', type: 'step', desc: 'SFT/LoRA' },
      { label: '评估', type: 'step', desc: '回归基准' },
      { label: '部署', type: 'answer', desc: '版本管理' },
    ],
    markdown: `## 微调不是银弹

若知识频繁变化，优先 **RAG + 工具**；若要稳定风格、格式、领域用语或特殊推理格式，再考虑 **SFT**。对齐阶段（RLHF/DPO 等）改善偏好与安全，但数据与评估成本高。

## 动画

${embed('seed-anim-ft')}

## LoRA 等 PEFT

在资源有限时，低秩适配可把可训练参数降到很小，便于多租户多技能适配。仍需小心灾难性遗忘与评估覆盖不足。

## 延伸阅读

- 站内：[评估系统](/knowledge/evaluation) · [Prompt 工程](/knowledge/prompt-eng)
`,
  },
  {
    slug: 'prompting',
    title: 'Prompting 技术清单',
    summary: '少样本、思维链、角色、结构化输出与防御性提示，面向 Agent 场景的实用清单。',
    category: 'LLM基础',
    level: '入门',
    tags: ['Prompting'],
    readMinutes: 11,
    template: 'cot',
    animationId: 'seed-anim-prompting',
    animationName: '提示模式组合',
    steps: [
      { label: '指令', type: 'step', desc: '清晰目标' },
      { label: '示例', type: 'step', desc: 'few-shot' },
      { label: '推理', type: 'step', desc: 'CoT' },
      { label: '格式', type: 'step', desc: 'JSON/schema' },
      { label: '校验', type: 'answer', desc: '程序侧验证' },
    ],
    markdown: `## 实用模式

1. **指令清晰**：动词开头，成功标准可检查  
2. **少样本**：覆盖边界情况  
3. **思维链**：难题拆解  
4. **结构化输出**：与工具/UI 对接  
5. **防御**：对不可信外部文本加边界标记  

## 动画

${embed('seed-anim-prompting')}

## Agent 特别提醒

工具参数错误时，把 **schema 错误信息**回传比骂模型「请遵守格式」更有效。提示与程序校验要一起设计。

## 延伸阅读

- 站内：[Prompt 工程](/knowledge/prompt-eng) · [CoT](/knowledge/cot)
`,
  },
];
