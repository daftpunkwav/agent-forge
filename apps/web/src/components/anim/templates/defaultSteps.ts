import type { AnimationStep, AnimationTemplate } from '@agentforge/shared';

/**
 * 默认步骤语义：
 * - type 驱动可视化高亮（ring/chain/tree/...）
 * - ReAct：input → (thought→action→observation)×N → answer
 */
export const DEFAULT_STEPS: Record<AnimationTemplate, AnimationStep[]> = {
  react: [
    {
      label: '用户提问',
      type: 'input',
      desc: '任务进入 Agent：需要检索事实并完成计算。环尚未启动。',
    },
    {
      label: 'Thought · 分析问题',
      type: 'thought',
      desc: '第 1 轮循环：推理「先搜索再计算」，高亮 Thought。',
    },
    {
      label: 'Action · 搜索工具',
      type: 'action',
      desc: '第 1 轮：调用 search，高亮 Action。',
    },
    {
      label: 'Observation · 搜索结果',
      type: 'observation',
      desc: '第 1 轮：工具返回摘要，高亮 Observation，准备回到 Thought。',
    },
    {
      label: 'Thought · 规划计算',
      type: 'thought',
      desc: '第 2 轮循环：根据观察决定调用计算器。',
    },
    {
      label: 'Action · 计算器',
      type: 'action',
      desc: '第 2 轮：执行 calculator。',
    },
    {
      label: 'Observation · 数值',
      type: 'observation',
      desc: '第 2 轮：拿到中间数值，信息已足够。',
    },
    {
      label: 'Thought · 综合',
      type: 'thought',
      desc: '第 3 轮：判断可以给出 Final Answer（或达最大循环次数则强制收敛）。',
    },
    {
      label: 'Answer · 最终答案',
      type: 'answer',
      desc: '退出环：输出可验证答案。Thought→Action→Observation 循环结束。',
    },
  ],
  cot: [
    { label: '问题', type: 'input', desc: '复杂问题进入链式推理' },
    { label: '分解', type: 'step', desc: '拆成可处理的子问题' },
    { label: '推导', type: 'step', desc: '逐步论证 / 计算' },
    { label: '校验', type: 'step', desc: '检查中间结论一致性' },
    { label: '结论', type: 'answer', desc: '汇总为最终答案' },
  ],
  tot: [
    { label: '根问题', type: 'root', desc: '定义搜索目标状态' },
    { label: '分支 A', type: 'branch', desc: '候选路径 A' },
    { label: '分支 B', type: 'branch', desc: '候选路径 B' },
    { label: '分支 C', type: 'branch', desc: '候选路径 C' },
    { label: '评估剪枝', type: 'eval', desc: '对分支打分并剪枝' },
    { label: '扩展最优', type: 'expand', desc: '沿高分路径继续搜索' },
    { label: '最优解', type: 'answer', desc: '回溯得到全局较优方案' },
  ],
  got: [
    { label: '创建节点', type: 'node', desc: '想法成为图中节点' },
    { label: '建立关系', type: 'edge', desc: '添加依赖 / 支持边' },
    { label: '扩展节点', type: 'node', desc: '引入新的中间结论' },
    { label: '聚合', type: 'aggregate', desc: '合并子图信息' },
    { label: '精炼', type: 'refine', desc: '修正冲突与噪声' },
    { label: '输出', type: 'answer', desc: '从图中抽取答案' },
  ],
  loop: [
    { label: '感知', type: 'sense', desc: '收集用户输入与环境状态' },
    { label: '规划', type: 'plan', desc: '生成下一步意图' },
    { label: '行动', type: 'act', desc: '调用工具或生成回复' },
    { label: '观察', type: 'observe', desc: '读取环境 / 工具反馈' },
    { label: '更新上下文', type: 'context', desc: '写入记忆并应用截断策略' },
    { label: '终止判断', type: 'stop', desc: '完成、失败或继续下一轮循环' },
  ],
  mcp: [
    { label: '建立连接', type: 'connect', desc: 'Client 握手连接 Server' },
    { label: 'tools/list', type: 'list', desc: '发现可用工具清单' },
    { label: 'tools/call', type: 'call', desc: '发起工具调用请求' },
    { label: 'resources/read', type: 'resource', desc: '读取资源句柄' },
    { label: '返回结果', type: 'result', desc: '结构化响应回传模型' },
  ],
  tool: [
    { label: '意图识别', type: 'intent', desc: '是否需要外部工具' },
    { label: '选择工具', type: 'select', desc: '按 schema 选型' },
    { label: '构造参数', type: 'args', desc: 'JSON 参数校验' },
    { label: '执行', type: 'exec', desc: '沙箱 / API 调用' },
    { label: '解析结果', type: 'parse', desc: '错误处理与截断' },
    { label: '写回上下文', type: 'continue', desc: 'Observation → 继续推理' },
  ],
  memory: [
    { label: '短期记忆', type: 'short', desc: '窗口内对话与工具结果' },
    { label: '工作记忆', type: 'working', desc: '当前任务结构化状态' },
    { label: '写入长期', type: 'write', desc: '摘要 / 向量入库' },
    { label: '检索', type: 'retrieve', desc: '按相关性召回' },
    { label: '注入上下文', type: 'inject', desc: '组装进当前 prompt' },
  ],
  harness: [
    { label: '目标与成功标准', type: 'goal', desc: '定义完成条件' },
    { label: '策略约束', type: 'policy', desc: '权限、预算、超时' },
    { label: '工具白名单', type: 'tools', desc: '能力边界' },
    { label: '受控运行', type: 'run', desc: 'Loop 在约束中执行' },
    { label: '观测评估', type: 'eval', desc: '轨迹、指标、回归' },
    { label: '人工闸门', type: 'gate', desc: '高风险操作确认' },
  ],
};

/** 作者端可选的可视化类型说明 */
export const VISUAL_KIND_DOCS: { kind: string; label: string; desc: string }[] = [
  { kind: 'ring', label: '环状循环', desc: 'ReAct / Agent Loop：固定节点上循环高亮' },
  { kind: 'chain', label: '链式', desc: 'CoT：线性步骤推进' },
  { kind: 'tree', label: '树状搜索', desc: 'ToT：分支、评估、剪枝' },
  { kind: 'graph', label: '关系图', desc: 'GoT：节点边聚合精炼' },
  { kind: 'flow', label: '流程图', desc: '工具调用 / Harness 阶段流' },
  { kind: 'dataflow', label: '数据流', desc: 'MCP：请求/响应包动态传递' },
  { kind: 'layers', label: '分层图', desc: '记忆系统层次' },
];
