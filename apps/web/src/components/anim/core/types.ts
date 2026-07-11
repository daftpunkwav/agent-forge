/** 动画场景核心类型 */

export type VisualKind =
  | 'ring' // 环状循环：ReAct / Loop
  | 'chain' // 链式：CoT
  | 'tree' // 树：ToT
  | 'graph' // 关系图：GoT
  | 'flow' // 流程图：Harness / Tool
  | 'dataflow' // 动态数据流：MCP
  | 'layers' // 分层：Memory
  | 'timeline'; // 通用时间线回退

export interface VizNode {
  id: string;
  label: string;
  sublabel?: string;
  /** 语义角色，用于配色 */
  role?: string;
  /** 布局提示 0–1（可选） */
  x?: number;
  y?: number;
}

export interface VizEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
  /** 是否绘制流动粒子 */
  flow?: boolean;
  curved?: boolean;
}

export interface VizFrame {
  /** 当前高亮节点 */
  activeNodeIds: string[];
  /** 当前高亮边 */
  activeEdgeIds: string[];
  /** 已完成节点（暗亮） */
  doneNodeIds: string[];
  /** 已完成边 */
  doneEdgeIds: string[];
  /** 中心主文案（环状图） */
  centerTitle?: string;
  centerSubtitle?: string;
  /** 循环计数 */
  cycle?: number;
  maxCycles?: number;
  /** 底部说明 */
  caption: string;
  /** 轨迹日志一行 */
  logLine?: string;
  /** 是否到达终态 */
  finished?: boolean;
  /** 数据流包位置 0–1 与边 id */
  packet?: { edgeId: string; t: number };
  /** 树/图：额外高亮路径节点 */
  pathNodeIds?: string[];
}

export interface SceneModel {
  kind: VisualKind;
  nodes: VizNode[];
  edges: VizEdge[];
  /** 由 stepIndex → 帧 */
  frames: VizFrame[];
  title?: string;
}

export const ROLE_COLORS: Record<string, string> = {
  thought: 'var(--primary)',
  action: 'var(--chart-5)',
  observation: 'var(--chart-2)',
  answer: 'var(--chart-3)',
  input: 'var(--muted-foreground)',
  step: 'var(--chart-1)',
  branch: 'var(--chart-2)',
  eval: 'var(--chart-5)',
  root: 'var(--primary)',
  node: 'var(--chart-1)',
  edge: 'var(--chart-4)',
  sense: 'var(--chart-2)',
  plan: 'var(--primary)',
  act: 'var(--chart-5)',
  observe: 'var(--chart-2)',
  context: 'var(--chart-4)',
  stop: 'var(--chart-3)',
  connect: 'var(--chart-1)',
  list: 'var(--chart-2)',
  call: 'var(--chart-5)',
  resource: 'var(--chart-4)',
  result: 'var(--chart-3)',
  client: 'var(--primary)',
  server: 'var(--chart-3)',
  short: 'var(--chart-1)',
  working: 'var(--chart-5)',
  write: 'var(--chart-2)',
  retrieve: 'var(--chart-4)',
  inject: 'var(--primary)',
  goal: 'var(--primary)',
  policy: 'var(--chart-5)',
  tools: 'var(--chart-2)',
  run: 'var(--chart-1)',
  gate: 'var(--destructive)',
  default: 'var(--foreground)',
};

export function roleColor(role?: string): string {
  if (!role) return ROLE_COLORS.default;
  return ROLE_COLORS[role] || ROLE_COLORS.default;
}
