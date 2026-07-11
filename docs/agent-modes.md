# Agent 两种模式说明

## 快速 Agent（悬停 / Fast）

| 项 | 说明 |
|----|------|
| 触发 | 鼠标悬停段落、列表、标题、表格、卡片等；或 `[data-agent-topic]` |
| 架构 | **单轮 completion**，不调用外部工具，无状态机循环 |
| 推理模式 | **Fast Direct**：直接给结论（禁止长链 CoT / 禁止完整 ReAct 轨迹） |
| 延迟 | 低；流式输出 + 本地缓存同一片段 |
| 输出 | 短 Markdown（2–4 句 + 类比） |
| 记忆 | 注入已掌握/学习中/最近话题，调节深度 |

## Agent 助手（面板 / Deep）

| 项 | 说明 |
|----|------|
| 触发 | 右下角面板对话；文章「Agent 详细讲解」 |
| 架构 | **单轮结构化生成**（Prompted ReAct **骨架**，当前**不是**真实 tool-loop） |
| 推理模式 | **Deep ReAct-Style**：`Thought → Explain → Practice → Next` |
| 延迟 | 中等；流式输出 |
| 输出 | 较长 Markdown，分节讲解 |
| 记忆 | 同快速，更强调「已掌握少重复、补缺口」 |

## 上下文与记忆

1. **LearningProgress**：阅读 / 标记已掌握  
2. **AgentMemory**：最近询问、技能事实  
3. **BYOK**：用户自带模型配置  
4. **风格**：设置中的毒舌/热情等  

## 与「真 ReAct Agent」的差距

真 ReAct 需要：Thought → **调用工具** → Observation → 循环。  
当前助手用 **提示词结构** 模拟阶段输出，适合学习讲解；若未来接入工具执行，可在同一面板扩展为真实 loop。
