import type { AnimationStep, AnimationTemplate } from '@agentforge/shared';
import type { SceneModel, VisualKind, VizEdge, VizFrame, VizNode } from './types';
import { resolveVisualKind } from '../registry';

function stepRole(s: AnimationStep): string {
  return (s.type || s.label || 'step').toLowerCase().split(/[\s:_-]/)[0];
}

/** ReAct / Loop：环上固定三相 + 多轮循环帧 */
function buildRingScene(steps: AnimationStep[], kindLabel: string): SceneModel {
  const isReact = kindLabel === 'react';
  const nodes: VizNode[] = isReact
    ? [
        { id: 'thought', label: 'Thought', sublabel: '推理', role: 'thought', x: 0.5, y: 0.18 },
        { id: 'action', label: 'Action', sublabel: '行动', role: 'action', x: 0.86, y: 0.72 },
        { id: 'observation', label: 'Observation', sublabel: '观察', role: 'observation', x: 0.14, y: 0.72 },
      ]
    : [
        { id: 'sense', label: 'Sense', sublabel: '感知', role: 'sense', x: 0.5, y: 0.16 },
        { id: 'plan', label: 'Plan', sublabel: '规划', role: 'plan', x: 0.88, y: 0.45 },
        { id: 'act', label: 'Act', sublabel: '行动', role: 'act', x: 0.72, y: 0.84 },
        { id: 'observe', label: 'Observe', sublabel: '观察', role: 'observe', x: 0.28, y: 0.84 },
        { id: 'update', label: 'Update', sublabel: '更新', role: 'context', x: 0.12, y: 0.45 },
      ];

  const ringOrder = nodes.map((n) => n.id);
  const edges: VizEdge[] = ringOrder.map((id, i) => {
    const to = ringOrder[(i + 1) % ringOrder.length];
    return { id: `e-${id}-${to}`, from: id, to, flow: true, curved: true };
  });

  const maxCycles = Math.max(
    1,
    steps.filter((s) => {
      const r = stepRole(s);
      return r === 'thought' || r === 'action' || r === 'act' || r === 'sense';
    }).length,
  );

  const frames: VizFrame[] = [];
  let cycle = 0;

  steps.forEach((s, i) => {
    const role = stepRole(s);
    let active = '';
    if (isReact) {
      if (role === 'input') active = '';
      else if (role === 'thought') active = 'thought';
      else if (role === 'action') active = 'action';
      else if (role === 'observation' || role === 'obs') active = 'observation';
      else if (role === 'answer') active = '';
      else active = 'thought';
    } else {
      if (role === 'sense') active = 'sense';
      else if (role === 'plan') active = 'plan';
      else if (role === 'act' || role === 'action') active = 'act';
      else if (role === 'observe' || role === 'observation') active = 'observe';
      else if (role === 'context' || role === 'update') active = 'update';
      else if (role === 'stop') active = '';
      else active = ringOrder[i % ringOrder.length];
    }

    if (active === 'thought' || active === 'sense') cycle += 1;

    const phaseIdx = active ? ringOrder.indexOf(active) : -1;
    const activeEdgeIds =
      phaseIdx >= 0
        ? [edges[(phaseIdx + ringOrder.length - 1) % ringOrder.length].id]
        : [];

    frames.push({
      activeNodeIds: active ? [active] : [],
      activeEdgeIds,
      doneNodeIds: [],
      doneEdgeIds: [],
      centerTitle:
        role === 'input'
          ? 'Question'
          : role === 'answer'
            ? 'Answer'
            : role === 'stop'
              ? 'Done'
              : `Cycle ${Math.max(1, cycle)}`,
      centerSubtitle:
        role === 'input'
          ? s.desc || s.label
          : role === 'answer'
            ? s.desc || s.label
            : `${active || '—'} · max ${maxCycles}`,
      cycle: Math.max(1, cycle),
      maxCycles,
      caption: s.desc || s.label,
      logLine: `${String(i + 1).padStart(2, '0')}  ${s.label}`,
      finished: role === 'answer' || role === 'stop',
      packet: activeEdgeIds[0] ? { edgeId: activeEdgeIds[0], t: 0.55 } : undefined,
    });

    // 累积 done：当前帧之前的 active 记为 done
    if (i > 0) {
      const prev = frames[i - 1];
      frames[i].doneNodeIds = [
        ...new Set([...prev.doneNodeIds, ...prev.activeNodeIds.filter((id) => !frames[i].activeNodeIds.includes(id))]),
      ];
      frames[i].doneEdgeIds = [
        ...new Set([...prev.doneEdgeIds, ...prev.activeEdgeIds.filter((id) => !frames[i].activeEdgeIds.includes(id))]),
      ];
    }
  });

  // 终态：全部 done
  if (frames.length) {
    const last = frames[frames.length - 1];
    if (last.finished) {
      last.doneNodeIds = ringOrder;
      last.doneEdgeIds = edges.map((e) => e.id);
      last.activeNodeIds = [];
      last.activeEdgeIds = [];
    }
  }

  return {
    kind: 'ring',
    nodes,
    edges,
    frames,
    title: isReact ? 'ReAct Cycle' : 'Agent Loop',
  };
}

function buildChainScene(steps: AnimationStep[]): SceneModel {
  const nodes: VizNode[] = steps.map((s, i) => ({
    id: `n${i}`,
    label: s.label.length > 14 ? s.label.slice(0, 12) + '…' : s.label,
    sublabel: s.type || '',
    role: stepRole(s),
    x: steps.length <= 1 ? 0.5 : i / (steps.length - 1),
    y: 0.45,
  }));
  const edges: VizEdge[] = nodes.slice(0, -1).map((n, i) => ({
    id: `e${i}`,
    from: n.id,
    to: nodes[i + 1].id,
    flow: true,
  }));
  const frames: VizFrame[] = steps.map((s, i) => ({
    activeNodeIds: [nodes[i].id],
    activeEdgeIds: i > 0 ? [edges[i - 1].id] : [],
    doneNodeIds: nodes.slice(0, i).map((n) => n.id),
    doneEdgeIds: edges.slice(0, Math.max(0, i - 1)).map((e) => e.id),
    caption: s.desc || s.label,
    logLine: `${i + 1}. ${s.label}`,
    pathNodeIds: nodes.slice(0, i + 1).map((n) => n.id),
    packet: i > 0 ? { edgeId: edges[i - 1].id, t: 0.6 } : undefined,
  }));
  return { kind: 'chain', nodes, edges, frames, title: 'Chain of Thought' };
}

function buildTreeScene(steps: AnimationStep[]): SceneModel {
  // 固定 ToT 布局：root + 3 branches + eval + best
  const nodes: VizNode[] = [
    { id: 'root', label: 'Root', sublabel: '问题', role: 'root', x: 0.5, y: 0.12 },
    { id: 'a', label: 'Branch A', sublabel: '候选', role: 'branch', x: 0.2, y: 0.42 },
    { id: 'b', label: 'Branch B', sublabel: '候选', role: 'branch', x: 0.5, y: 0.42 },
    { id: 'c', label: 'Branch C', sublabel: '候选', role: 'branch', x: 0.8, y: 0.42 },
    { id: 'eval', label: 'Evaluate', sublabel: '评估', role: 'eval', x: 0.5, y: 0.68 },
    { id: 'best', label: 'Best Path', sublabel: '最优', role: 'answer', x: 0.5, y: 0.9 },
  ];
  const edges: VizEdge[] = [
    { id: 'e-ra', from: 'root', to: 'a' },
    { id: 'e-rb', from: 'root', to: 'b' },
    { id: 'e-rc', from: 'root', to: 'c' },
    { id: 'e-ae', from: 'a', to: 'eval' },
    { id: 'e-be', from: 'b', to: 'eval' },
    { id: 'e-ce', from: 'c', to: 'eval' },
    { id: 'e-eb', from: 'eval', to: 'best', flow: true },
  ];

  const map: Record<string, { nodes: string[]; edges: string[]; path?: string[] }> = {
    root: { nodes: ['root'], edges: [] },
    input: { nodes: ['root'], edges: [] },
    branch: { nodes: ['root', 'a', 'b', 'c'], edges: ['e-ra', 'e-rb', 'e-rc'] },
    eval: { nodes: ['a', 'b', 'c', 'eval'], edges: ['e-ae', 'e-be', 'e-ce'] },
    expand: { nodes: ['eval', 'b'], edges: ['e-be'], path: ['root', 'b', 'eval'] },
    answer: { nodes: ['best'], edges: ['e-eb'], path: ['root', 'b', 'eval', 'best'] },
  };

  let branchCount = 0;
  const frames: VizFrame[] = steps.map((s, i) => {
    const role = stepRole(s);
    let key = role;
    if (role === 'branch') {
      branchCount += 1;
      const id = branchCount === 1 ? 'a' : branchCount === 2 ? 'b' : 'c';
      return {
        activeNodeIds: [id],
        activeEdgeIds: [`e-r${id}`],
        doneNodeIds: ['root', ...(['a', 'b', 'c'] as const).slice(0, branchCount - 1)],
        doneEdgeIds: [],
        caption: s.desc || s.label,
        logLine: `${i + 1}. ${s.label}`,
        pathNodeIds: ['root', id],
      };
    }
    if (role === 'expand') key = 'expand';
    const m = map[key] || map.root;
    return {
      activeNodeIds: m.nodes.slice(-1),
      activeEdgeIds: m.edges,
      doneNodeIds: m.nodes.slice(0, -1),
      doneEdgeIds: [],
      caption: s.desc || s.label,
      logLine: `${i + 1}. ${s.label}`,
      pathNodeIds: m.path || m.nodes,
    };
  });

  return { kind: 'tree', nodes, edges, frames, title: 'Tree of Thoughts' };
}

function buildGraphScene(steps: AnimationStep[]): SceneModel {
  const nodes: VizNode[] = [
    { id: 'n1', label: 'Idea A', role: 'node', x: 0.25, y: 0.3 },
    { id: 'n2', label: 'Idea B', role: 'node', x: 0.75, y: 0.28 },
    { id: 'n3', label: 'Idea C', role: 'node', x: 0.2, y: 0.7 },
    { id: 'n4', label: 'Merge', role: 'aggregate', x: 0.55, y: 0.55 },
    { id: 'n5', label: 'Refine', role: 'refine', x: 0.8, y: 0.75 },
    { id: 'out', label: 'Answer', role: 'answer', x: 0.5, y: 0.9 },
  ];
  const edges: VizEdge[] = [
    { id: 'e12', from: 'n1', to: 'n2', curved: true },
    { id: 'e13', from: 'n1', to: 'n3' },
    { id: 'e24', from: 'n2', to: 'n4', flow: true },
    { id: 'e34', from: 'n3', to: 'n4', flow: true },
    { id: 'e45', from: 'n4', to: 'n5' },
    { id: 'e5o', from: 'n5', to: 'out', flow: true },
  ];

  const progressive = [
    { n: ['n1'], e: [] as string[] },
    { n: ['n1', 'n2'], e: ['e12'] },
    { n: ['n1', 'n2', 'n3'], e: ['e12', 'e13'] },
    { n: ['n1', 'n2', 'n3', 'n4'], e: ['e24', 'e34'] },
    { n: ['n4', 'n5'], e: ['e45'] },
    { n: ['n5', 'out'], e: ['e5o'] },
  ];

  const frames: VizFrame[] = steps.map((s, i) => {
    const p = progressive[Math.min(i, progressive.length - 1)];
    return {
      activeNodeIds: [p.n[p.n.length - 1]],
      activeEdgeIds: p.e.slice(-1),
      doneNodeIds: p.n.slice(0, -1),
      doneEdgeIds: p.e.slice(0, -1),
      caption: s.desc || s.label,
      logLine: `${i + 1}. ${s.label}`,
      pathNodeIds: p.n,
      packet: p.e.length ? { edgeId: p.e[p.e.length - 1], t: 0.5 } : undefined,
    };
  });
  return { kind: 'graph', nodes, edges, frames, title: 'Graph of Thoughts' };
}

function buildFlowScene(steps: AnimationStep[]): SceneModel {
  const nodes: VizNode[] = steps.map((s, i) => ({
    id: `f${i}`,
    label: s.label.length > 16 ? s.label.slice(0, 14) + '…' : s.label,
    sublabel: s.type || `step ${i + 1}`,
    role: stepRole(s),
    x: steps.length <= 1 ? 0.5 : i / (steps.length - 1),
    y: 0.42 + (i % 2 === 0 ? 0 : 0.12),
  }));
  const edges: VizEdge[] = nodes.slice(0, -1).map((n, i) => ({
    id: `fe${i}`,
    from: n.id,
    to: nodes[i + 1].id,
    flow: true,
    curved: i % 2 === 0,
  }));
  const frames: VizFrame[] = steps.map((s, i) => ({
    activeNodeIds: [nodes[i].id],
    activeEdgeIds: i > 0 ? [edges[i - 1].id] : [],
    doneNodeIds: nodes.slice(0, i).map((n) => n.id),
    doneEdgeIds: edges.slice(0, Math.max(0, i - 1)).map((e) => e.id),
    caption: s.desc || s.label,
    logLine: `${i + 1}. ${s.label}`,
    packet: i > 0 ? { edgeId: edges[i - 1].id, t: 0.65 } : undefined,
  }));
  return { kind: 'flow', nodes, edges, frames, title: 'Process Flow' };
}

function buildDataflowScene(steps: AnimationStep[]): SceneModel {
  const nodes: VizNode[] = [
    { id: 'client', label: 'MCP Client', sublabel: 'Host / Agent', role: 'client', x: 0.2, y: 0.5 },
    { id: 'server', label: 'MCP Server', sublabel: 'Tools / Resources', role: 'server', x: 0.8, y: 0.5 },
  ];
  const edges: VizEdge[] = [
    { id: 'req', from: 'client', to: 'server', label: 'request', flow: true },
    { id: 'res', from: 'server', to: 'client', label: 'response', flow: true, curved: true },
  ];
  const frames: VizFrame[] = steps.map((s, i) => {
    const role = stepRole(s);
    // 除结果/资源类步骤外均为出站请求
    const outbound = !['result', 'resource'].includes(role);
    // alternate roughly by step
    const toServer = i % 2 === 0 || outbound;
    return {
      activeNodeIds: toServer ? ['client', 'server'] : ['server', 'client'],
      activeEdgeIds: [toServer ? 'req' : 'res'],
      doneNodeIds: i > 0 ? ['client', 'server'] : ['client'],
      doneEdgeIds: [],
      caption: s.desc || s.label,
      logLine: `${i + 1}. ${s.label}`,
      packet: { edgeId: toServer ? 'req' : 'res', t: 0.35 + (i % 3) * 0.15 },
      centerTitle: toServer ? '→ request' : '← response',
      centerSubtitle: s.label,
    };
  });
  return { kind: 'dataflow', nodes, edges, frames, title: 'MCP Data Flow' };
}

function buildLayersScene(steps: AnimationStep[]): SceneModel {
  const layerIds = ['short', 'working', 'long', 'retrieve', 'inject'];
  const nodes: VizNode[] = [
    { id: 'short', label: 'Short-term', sublabel: '对话窗口', role: 'short', x: 0.5, y: 0.15 },
    { id: 'working', label: 'Working', sublabel: '任务状态', role: 'working', x: 0.5, y: 0.35 },
    { id: 'long', label: 'Long-term', sublabel: '向量 / DB', role: 'write', x: 0.5, y: 0.55 },
    { id: 'retrieve', label: 'Retrieve', sublabel: '召回', role: 'retrieve', x: 0.5, y: 0.72 },
    { id: 'inject', label: 'Inject', sublabel: '注入 Context', role: 'inject', x: 0.5, y: 0.9 },
  ];
  const edges: VizEdge[] = layerIds.slice(0, -1).map((id, i) => ({
    id: `le${i}`,
    from: id,
    to: layerIds[i + 1],
    flow: true,
  }));
  const frames: VizFrame[] = steps.map((s, i) => {
    const role = stepRole(s);
    const found = layerIds.findIndex((id) => role.includes(id) || id.startsWith(role.slice(0, 4)));
    // 未匹配时按步骤序号落到对应层，而不是恒落第 0 层
    const useIdx = found >= 0 ? found : Math.min(i, layerIds.length - 1);
    return {
      activeNodeIds: [layerIds[useIdx]],
      activeEdgeIds: useIdx > 0 ? [edges[useIdx - 1].id] : [],
      doneNodeIds: layerIds.slice(0, useIdx),
      doneEdgeIds: edges.slice(0, useIdx).map((e) => e.id),
      caption: s.desc || s.label,
      logLine: `${i + 1}. ${s.label}`,
      packet: useIdx > 0 ? { edgeId: edges[useIdx - 1].id, t: 0.5 } : undefined,
    };
  });
  return { kind: 'layers', nodes, edges, frames, title: 'Memory Layers' };
}

export function buildSceneFromSteps(
  steps: AnimationStep[],
  template?: string,
): SceneModel {
  const safe = steps.length ? steps : [{ label: 'Start', type: 'step', desc: '开始' }];
  const kind = resolveVisualKind(template);
  switch (kind) {
    case 'ring':
      return buildRingScene(safe, template === 'loop' ? 'loop' : 'react');
    case 'chain':
      return buildChainScene(safe);
    case 'tree':
      return buildTreeScene(safe);
    case 'graph':
      return buildGraphScene(safe);
    case 'flow':
      return buildFlowScene(safe);
    case 'dataflow':
      return buildDataflowScene(safe);
    case 'layers':
      return buildLayersScene(safe);
    default:
      return buildChainScene(safe);
  }
}

export function visualKindForTemplate(template?: string): VisualKind {
  return resolveVisualKind(template);
}

export type { AnimationTemplate };
