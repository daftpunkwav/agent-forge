import type { useAnimationPlayer } from '@/hooks/useAnimationPlayer';

type Player = ReturnType<typeof useAnimationPlayer>;

export function AnimationControls({ player }: { player: Player }) {
  return (
    <div className="anim-controls">
      <button type="button" className="anim-btn" aria-label="重置" title="重置" onClick={player.reset}>
        ↺
      </button>
      <button
        type="button"
        className="anim-btn"
        aria-label="上一步"
        title="上一步"
        onClick={player.stepBack}
      >
        ‹
      </button>
      <button
        type="button"
        className="anim-btn primary"
        aria-label={player.isPlaying ? '暂停' : '播放'}
        title={player.isPlaying ? '暂停' : '播放'}
        onClick={player.toggle}
      >
        {player.isPlaying ? '❚❚' : '▶'}
      </button>
      <button type="button" className="anim-btn" aria-label="下一步" title="下一步" onClick={player.step}>
        ›
      </button>
      <span className="anim-step-info">
        {player.currentStep + 1}/{player.totalSteps}
      </span>
      <select
        className="anim-speed-select"
        aria-label="播放速度"
        value={player.speed}
        onChange={(e) => player.setSpeed(Number(e.target.value))}
      >
        <option value={0.5}>0.5x</option>
        <option value={1}>1x</option>
        <option value={1.5}>1.5x</option>
        <option value={2}>2x</option>
      </select>
    </div>
  );
}
