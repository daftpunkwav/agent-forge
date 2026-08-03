import type { ReactNode } from 'react';
import { useId } from 'react';
import type { SceneModel, VizFrame } from '../core/types';
import { roleColor } from '../core/types';
import { arcPath, curvePath, pointOnLine, pt, ringPoint } from './layoutMath';

const W = 720;
const H = 360;

export function SceneCanvas({
  scene,
  frame,
  stepIndex,
}: {
  scene: SceneModel;
  frame: VizFrame;
  stepIndex: number;
}) {
  if (scene.kind === 'ring') {
    return <RingCanvas scene={scene} frame={frame} />;
  }
  if (scene.kind === 'dataflow') {
    return <DataflowCanvas frame={frame} scene={scene} />;
  }
  if (scene.kind === 'layers') {
    return <LayersCanvas scene={scene} frame={frame} />;
  }
  if (scene.kind === 'tree' || scene.kind === 'graph') {
    return <GraphCanvas scene={scene} frame={frame} />;
  }
  // chain / flow / timeline
  return <FlowCanvas scene={scene} frame={frame} stepIndex={stepIndex} />;
}

function RingCanvas({ scene, frame }: { scene: SceneModel; frame: VizFrame }) {
  const uid = useId().replace(/:/g, '');
  const glowId = `ringGlow-${uid}`;
  const arrowId = `arrow-${uid}`;
  const cx = W / 2;
  const cy = H / 2 + 8;
  const R = 118;
  const n = scene.nodes.length;
  const positions = scene.nodes.map((node, i) => {
    // 从 -90° 开始均分
    const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const p = ringPoint(cx, cy, R, ang);
    return { node, ang, ...p };
  });

  const posMap = Object.fromEntries(positions.map((p) => [p.node.id, p]));

  return (
    <svg
      className="viz-svg"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={scene.title || 'ring'}
      data-agent-zone="knowledge"
    >
      <defs>
        <radialGradient id={glowId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="transparent" stopOpacity="0" />
        </radialGradient>
        <marker id={arrowId} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--primary)" />
        </marker>
      </defs>
      <circle cx={cx} cy={cy} r={R + 36} fill={`url(#${glowId})`} />
      <circle
        cx={cx}
        cy={cy}
        r={R}
        fill="none"
        stroke="var(--border)"
        strokeWidth={2}
        strokeDasharray="4 10"
        opacity={0.45}
      />

      {/* 环边 */}
      {scene.edges.map((e) => {
        const a = posMap[e.from];
        const b = posMap[e.to];
        if (!a || !b) return null;
        const active = frame.activeEdgeIds.includes(e.id);
        const done = frame.doneEdgeIds.includes(e.id);
        const d = arcPath(cx, cy, R, a.ang, b.ang);
        return (
          <path
            key={e.id}
            d={d}
            className={`viz-edge${active ? ' active viz-edge-flow' : ''}${done ? ' done' : ''}`}
            style={{ ['--edge-color' as string]: roleColor(a.node.role) }}
            markerEnd={active ? `url(#${arrowId})` : undefined}
          />
        );
      })}

      {/* 中心 */}
      <g
        data-agent-term={frame.centerTitle || 'Agent'}
        data-agent-text={`${frame.centerTitle || 'Agent'}：${frame.centerSubtitle || scene.title || '循环中心状态'}`}
        data-agent-topic
        style={{ cursor: 'help' }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={52}
          fill="var(--card)"
          stroke={frame.finished ? 'var(--chart-3)' : 'var(--border)'}
          strokeWidth={frame.finished ? 2.5 : 1.5}
        />
        <text className="viz-center-title" x={cx} y={cy - 6}>
          {frame.centerTitle || 'Agent'}
        </text>
        <text className="viz-center-sub" x={cx} y={cy + 14}>
          {(frame.centerSubtitle || '').slice(0, 28)}
        </text>
        {frame.cycle != null && frame.maxCycles != null && !frame.finished ? (
          <text className="viz-center-sub" x={cx} y={cy + 30}>
            loop {frame.cycle}/{frame.maxCycles}
          </text>
        ) : null}
      </g>

      {/* 节点 */}
      {positions.map(({ node, x, y }) => {
        const active = frame.activeNodeIds.includes(node.id);
        const done = frame.doneNodeIds.includes(node.id);
        const color = roleColor(node.role);
        const explain = `${node.label}${node.sublabel ? `（${node.sublabel}）` : ''}：ReAct/Agent 循环中的「${node.label}」阶段。`;
        return (
          <g
            key={node.id}
            className="viz-fade-in"
            data-node-id={node.id}
            data-agent-term={node.label}
            data-agent-text={explain}
            data-agent-topic
            data-agent-hint={node.sublabel || node.role || node.label}
            style={{ cursor: 'help' }}
          >
            <circle
              className={`viz-node-circle${active ? ' active pulse' : ''}`}
              cx={x}
              cy={y}
              r={active ? 28 : 24}
              fill={active ? color : done ? `color-mix(in srgb, ${color} 22%, var(--card))` : 'var(--card)'}
              stroke={active || done ? color : 'var(--border)'}
              strokeWidth={active ? 3 : 1.5}
              style={{ ['--node-color' as string]: color }}
            />
            <text className="viz-node-label" x={x} y={y - 2} style={{ fill: active ? 'var(--primary-foreground)' : undefined }}>
              {node.label}
            </text>
            {node.sublabel ? (
              <text className="viz-node-sub" x={x} y={y + 12} style={{ fill: active ? 'var(--primary-foreground)' : undefined, opacity: active ? 0.9 : 1 }}>
                {node.sublabel}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* 流动包 */}
      {frame.packet && posMap[scene.edges.find((e) => e.id === frame.packet!.edgeId)?.from || ''] ? (
        <PacketOnArc
          cx={cx}
          cy={cy}
          r={R}
          fromAng={posMap[scene.edges.find((e) => e.id === frame.packet!.edgeId)!.from].ang}
          toAng={posMap[scene.edges.find((e) => e.id === frame.packet!.edgeId)!.to].ang}
          t={frame.packet.t}
        />
      ) : null}
    </svg>
  );
}

function PacketOnArc({
  cx,
  cy,
  r,
  fromAng,
  toAng,
  t,
}: {
  cx: number;
  cy: number;
  r: number;
  fromAng: number;
  toAng: number;
  t: number;
}) {
  let delta = toAng - fromAng;
  while (delta <= 0) delta += Math.PI * 2;
  const ang = fromAng + delta * t;
  const p = ringPoint(cx, cy, r, ang);
  return <circle className="viz-packet" cx={p.x} cy={p.y} r={6} fill="var(--primary)" />;
}

function FlowCanvas({
  scene,
  frame,
}: {
  scene: SceneModel;
  frame: VizFrame;
  stepIndex: number;
}) {
  const pos = Object.fromEntries(
    scene.nodes.map((n) => {
      const p = pt(n.x ?? 0.5, n.y ?? 0.5, W, H, 56);
      return [n.id, p];
    }),
  );

  return (
    <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-agent-zone="knowledge">
      <defs>
        <marker id="flowArrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="var(--muted-foreground)" />
        </marker>
        <marker id="flowArrowActive" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">
          <path d="M0,0 L7,3 L0,6 Z" fill="var(--primary)" />
        </marker>
      </defs>

      {scene.edges.map((e) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        const active = frame.activeEdgeIds.includes(e.id);
        const done = frame.doneEdgeIds.includes(e.id);
        const d = curvePath(a.x, a.y, b.x, b.y, e.curved);
        return (
          <path
            key={e.id}
            d={d}
            className={`viz-edge${active ? ' active' : ''}${active && e.flow ? ' viz-edge-flow' : ''}${done ? ' done' : ''}`}
            markerEnd={active ? 'url(#flowArrowActive)' : 'url(#flowArrow)'}
          />
        );
      })}

      {scene.nodes.map((n) => {
        const p = pos[n.id];
        if (!p) return null;
        const active = frame.activeNodeIds.includes(n.id);
        const done = frame.doneNodeIds.includes(n.id);
        const color = roleColor(n.role);
        const bw = 88;
        const bh = 44;
        const explain = `${n.label}${n.sublabel ? `（${n.sublabel}）` : ''}：流程中的步骤节点。`;
        return (
          <g
            key={n.id}
            data-node-id={n.id}
            data-agent-term={n.label}
            data-agent-text={explain}
            data-agent-topic
            style={{ cursor: 'help' }}
          >
            <rect
              x={p.x - bw / 2}
              y={p.y - bh / 2}
              width={bw}
              height={bh}
              rx={12}
              fill={active ? color : done ? `color-mix(in srgb, ${color} 18%, var(--card))` : 'var(--card)'}
              stroke={active || done ? color : 'var(--border)'}
              strokeWidth={active ? 2.5 : 1.5}
              className={active ? 'viz-node-circle active' : 'viz-node-circle'}
              style={{ ['--node-color' as string]: color }}
            />
            <text className="viz-node-label" x={p.x} y={p.y - 2} style={{ fill: active ? 'var(--primary-foreground)' : undefined, fontSize: 11 }}>
              {n.label}
            </text>
            {n.sublabel ? (
              <text className="viz-node-sub" x={p.x} y={p.y + 12} style={{ fill: active ? 'var(--primary-foreground)' : undefined, opacity: 0.85 }}>
                {n.sublabel}
              </text>
            ) : null}
          </g>
        );
      })}

      {frame.packet ? (
        <PacketOnEdge scene={scene} pos={pos} edgeId={frame.packet.edgeId} t={frame.packet.t} />
      ) : null}
    </svg>
  );
}

function GraphCanvas({ scene, frame }: { scene: SceneModel; frame: VizFrame }) {
  const pos = Object.fromEntries(
    scene.nodes.map((n) => {
      const p = pt(n.x ?? 0.5, n.y ?? 0.5, W, H, 50);
      return [n.id, p];
    }),
  );

  return (
    <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-agent-zone="knowledge">
      {scene.edges.map((e) => {
        const a = pos[e.from];
        const b = pos[e.to];
        if (!a || !b) return null;
        const active = frame.activeEdgeIds.includes(e.id) || (frame.pathNodeIds || []).includes(e.from) && (frame.pathNodeIds || []).includes(e.to);
        const done = frame.doneEdgeIds.includes(e.id);
        return (
          <path
            key={e.id}
            d={curvePath(a.x, a.y, b.x, b.y, e.curved ?? true)}
            className={`viz-edge${active ? ' active' : ''}${e.flow && active ? ' viz-edge-flow' : ''}${done ? ' done' : ''}`}
          />
        );
      })}
      {scene.nodes.map((n) => {
        const p = pos[n.id];
        const active = frame.activeNodeIds.includes(n.id);
        const onPath = (frame.pathNodeIds || []).includes(n.id);
        const done = frame.doneNodeIds.includes(n.id);
        const color = roleColor(n.role);
        const explain = `${n.label}：图中节点，表示推理/状态单元。`;
        return (
          <g
            key={n.id}
            data-node-id={n.id}
            data-agent-term={n.label}
            data-agent-text={explain}
            data-agent-topic
            style={{ cursor: 'help' }}
          >
            <circle
              cx={p.x}
              cy={p.y}
              r={active ? 26 : 22}
              fill={active ? color : onPath || done ? `color-mix(in srgb, ${color} 20%, var(--card))` : 'var(--card)'}
              stroke={active || onPath || done ? color : 'var(--border)'}
              strokeWidth={active ? 3 : 1.5}
              className={`viz-node-circle${active ? ' active pulse' : ''}`}
              style={{ ['--node-color' as string]: color }}
            />
            <text className="viz-node-label" x={p.x} y={p.y + 4} style={{ fill: active ? 'var(--primary-foreground)' : undefined, fontSize: 11 }}>
              {n.label}
            </text>
          </g>
        );
      })}
      {frame.packet ? <PacketOnEdge scene={scene} pos={pos} edgeId={frame.packet.edgeId} t={frame.packet.t} /> : null}
    </svg>
  );
}

function DataflowCanvas({ frame }: { scene: SceneModel; frame: VizFrame }) {
  const client = pt(0.18, 0.5, W, H, 40);
  const server = pt(0.82, 0.5, W, H, 40);

  return (
    <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-agent-zone="knowledge">
      {/* 通道 */}
      <path
        d={curvePath(client.x + 60, client.y - 18, server.x - 60, server.y - 18, true)}
        className={`viz-edge${frame.activeEdgeIds.includes('req') ? ' active viz-edge-flow' : ''}`}
        pointerEvents="none"
      />
      <path
        d={curvePath(server.x - 60, server.y + 18, client.x + 60, client.y + 18, true)}
        className={`viz-edge${frame.activeEdgeIds.includes('res') ? ' active viz-edge-flow' : ''}`}
        pointerEvents="none"
      />
      <text className="viz-node-sub" x={W / 2} y={H * 0.32} pointerEvents="none">
        request →
      </text>
      <text className="viz-node-sub" x={W / 2} y={H * 0.72} pointerEvents="none">
        ← response
      </text>

      {[
        { id: 'client', p: client, label: 'MCP Client', sub: 'Host / Agent', role: 'client' },
        { id: 'server', p: server, label: 'MCP Server', sub: 'Tools / Resources', role: 'server' },
      ].map((box) => {
        const active = frame.activeNodeIds.includes(box.id);
        const color = roleColor(box.role);
        const explain = `${box.label}（${box.sub}）：数据流中的通信端点。`;
        return (
          <g
            key={box.id}
            data-node-id={box.id}
            data-agent-term={box.label}
            data-agent-text={explain}
            data-agent-topic
            data-agent-hint={box.sub}
            style={{ cursor: 'help' }}
          >
            <rect
              x={box.p.x - 70}
              y={box.p.y - 40}
              width={140}
              height={80}
              rx={16}
              fill={active ? `color-mix(in srgb, ${color} 18%, var(--card))` : 'var(--card)'}
              stroke={active ? color : 'var(--border)'}
              strokeWidth={active ? 2.5 : 1.5}
            />
            <text className="viz-node-label" x={box.p.x} y={box.p.y - 4}>
              {box.label}
            </text>
            <text className="viz-node-sub" x={box.p.x} y={box.p.y + 14}>
              {box.sub}
            </text>
          </g>
        );
      })}

      {frame.packet ? (
        <circle
          className="viz-packet"
          r={7}
          fill="var(--primary)"
          cx={
            frame.packet.edgeId === 'req'
              ? client.x + 60 + (server.x - 60 - (client.x + 60)) * frame.packet.t
              : server.x - 60 + (client.x + 60 - (server.x - 60)) * frame.packet.t
          }
          cy={
            frame.packet.edgeId === 'req'
              ? client.y - 18 + (server.y - 18 - (client.y - 18)) * frame.packet.t - 12 * Math.sin(frame.packet.t * Math.PI)
              : server.y + 18 + (client.y + 18 - (server.y + 18)) * frame.packet.t + 12 * Math.sin(frame.packet.t * Math.PI)
          }
        />
      ) : null}

      {frame.centerTitle ? (
        <text className="viz-center-title" x={W / 2} y={36}>
          {frame.centerTitle}
        </text>
      ) : null}
    </svg>
  );
}

function LayersCanvas({ scene, frame }: { scene: SceneModel; frame: VizFrame }) {
  const h = 48;
  const gap = 14;
  const top = 30;
  const left = 120;
  const width = W - 240;

  return (
    <svg className="viz-svg" viewBox={`0 0 ${W} ${H}`} role="img" data-agent-zone="knowledge">
      {scene.nodes.map((n, i) => {
        const y = top + i * (h + gap);
        const active = frame.activeNodeIds.includes(n.id);
        const done = frame.doneNodeIds.includes(n.id);
        const color = roleColor(n.role);
        const explain = `${n.label}${n.sublabel ? `（${n.sublabel}）` : ''}：分层架构中的一层。`;
        return (
          <g
            key={n.id}
            data-node-id={n.id}
            data-agent-term={n.label}
            data-agent-text={explain}
            data-agent-topic
            data-agent-hint={n.sublabel || n.role || n.label}
            style={{ cursor: 'help' }}
          >
            <rect
              x={left}
              y={y}
              width={width}
              height={h}
              rx={12}
              fill={active ? color : done ? `color-mix(in srgb, ${color} 16%, var(--card))` : 'var(--card)'}
              stroke={active || done ? color : 'var(--border)'}
              strokeWidth={active ? 2.5 : 1.5}
              opacity={i > frame.doneNodeIds.length && !active ? 0.4 : 1}
            />
            <text
              className="viz-node-label"
              x={left + 20}
              y={y + h / 2 + 4}
              style={{ textAnchor: 'start', fill: active ? 'var(--primary-foreground)' : undefined }}
            >
              {n.label}
            </text>
            <text
              className="viz-node-sub"
              x={left + width - 20}
              y={y + h / 2 + 4}
              style={{ textAnchor: 'end', fill: active ? 'var(--primary-foreground)' : undefined }}
            >
              {n.sublabel}
            </text>
            {i < scene.nodes.length - 1 ? (
              <path
                d={`M ${left + width / 2} ${y + h} L ${left + width / 2} ${y + h + gap}`}
                className={`viz-edge${frame.activeEdgeIds.includes(`le${i}`) ? ' active viz-edge-flow' : ''}`}
                pointerEvents="none"
              />
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

function PacketOnEdge({
  scene,
  pos,
  edgeId,
  t,
}: {
  scene: SceneModel;
  pos: Record<string, { x: number; y: number }>;
  edgeId: string;
  t: number;
}) {
  const e = scene.edges.find((x) => x.id === edgeId);
  if (!e) return null;
  const a = pos[e.from];
  const b = pos[e.to];
  if (!a || !b) return null;
  const p = pointOnLine(a.x, a.y, b.x, b.y, t);
  return <circle className="viz-packet" cx={p.x} cy={p.y} r={6} fill="var(--primary)" />;
}

export function SceneStage({
  scene,
  frame,
  stepIndex,
  logLines,
}: {
  scene: SceneModel;
  frame: VizFrame;
  stepIndex: number;
  logLines: string[];
}): ReactNode {
  return (
    <div className="viz-stage">
      <SceneCanvas scene={scene} frame={frame} stepIndex={stepIndex} />
      <p className="viz-caption">{frame.caption}</p>
      {logLines.length > 0 ? (
        <div className="viz-log" aria-label="执行轨迹">
          {logLines.map((line, i) => (
            <div
              key={`${line}-${i}`}
              className={`viz-log-line${i === stepIndex ? ' active' : i < stepIndex ? ' done' : ''}`}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
