import { useMemo } from 'react';
import type { AnimationDef } from '@agentforge/shared';
import { useAnimationPlayer } from '@/hooks/useAnimationPlayer';
import { AnimationControls } from './AnimationControls';
import { DEFAULT_STEPS } from './templates/defaultSteps';
import { buildSceneFromSteps, visualKindForTemplate } from './core/buildScene';
import { SceneStage } from './primitives/SceneCanvas';
import './anim-engine.css';

export function AnimationViewer({
  animation,
  title,
}: {
  animation?: AnimationDef | null;
  title?: string;
}) {
  const template = animation?.template || 'react';
  const steps =
    animation?.steps?.length
      ? animation.steps
      : DEFAULT_STEPS[template as keyof typeof DEFAULT_STEPS] || DEFAULT_STEPS.react;

  const scene = useMemo(() => buildSceneFromSteps(steps, template), [steps, template]);
  const player = useAnimationPlayer({ totalSteps: scene.frames.length || steps.length });
  const frame = scene.frames[player.currentStep] || scene.frames[0];
  const header = title || animation?.name || scene.title || template.toUpperCase();
  const kind = visualKindForTemplate(template);

  const logLines = useMemo(
    () => scene.frames.map((f) => f.logLine || f.caption).filter(Boolean) as string[],
    [scene.frames],
  );

  if (!frame) {
    return (
      <div className="anim-shell">
        <div className="anim-shell-header">
          <span>{header}</span>
        </div>
        <div className="anim-stage">
          <p className="viz-caption">暂无动画帧</p>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-shell">
      <div className="anim-shell-header">
        <span>{header}</span>
        <span style={{ fontWeight: 400, fontSize: 11 }}>
          · {template} · {kind}
        </span>
        {frame.cycle != null && frame.maxCycles != null && !frame.finished ? (
          <span
            style={{
              marginLeft: 'auto',
              font: '600 11px/1 var(--font-mono)',
              color: 'var(--primary)',
            }}
          >
            CYCLE {frame.cycle}/{frame.maxCycles}
          </span>
        ) : null}
        {frame.finished ? (
          <span
            style={{
              marginLeft: 'auto',
              font: '600 11px/1 var(--font-mono)',
              color: 'var(--chart-3)',
            }}
          >
            COMPLETE
          </span>
        ) : null}
      </div>
      <div className="anim-stage" style={{ paddingBottom: 8 }} data-agent-zone="knowledge">
        <SceneStage
          scene={scene}
          frame={frame}
          stepIndex={player.currentStep}
          logLines={logLines}
        />
      </div>
      <AnimationControls player={player} />
    </div>
  );
}

/** 仅按模板名展示默认步骤 */
export function TemplateAnimation({
  template,
  name,
}: {
  template: string;
  name?: string;
}) {
  const steps = DEFAULT_STEPS[template as keyof typeof DEFAULT_STEPS] || DEFAULT_STEPS.react;
  return (
    <AnimationViewer
      animation={{ id: template, name: name || template, template, steps }}
      title={name || template.toUpperCase()}
    />
  );
}
