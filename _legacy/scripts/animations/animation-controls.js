/* ═══════════════════════════════════════════════════════════════
   animation-controls.js — 动画播放器UI控件
   为每个动画容器添加播放控制栏
   ═══════════════════════════════════════════════════════════════ */

class AnimationControls {
  constructor(player, options = {}) {
    this.player = player;
    this.stepFormat = options.stepFormat || '{current}/{total}';
    this.viz = options.viz || null; // 可选：对应的viz实例，重置时联动清理
    this.container = player.container;
    this._build();
  }

  _build() {
    const controls = document.createElement('div');
    controls.className = 'anim-controls';
    controls.innerHTML = `
      <button class="anim-btn" data-action="reset" aria-label="重置" title="重置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
      </button>
      <button class="anim-btn" data-action="stepBack" aria-label="上一步" title="上一步">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="anim-btn primary" data-action="toggle" aria-label="播放/暂停" title="播放/暂停">
        <svg id="play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
      </button>
      <button class="anim-btn" data-action="step" aria-label="下一步" title="下一步">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <span class="anim-step-info" id="anim-step-info">${this.stepFormat.replace('{current}', '0').replace('{total}', '1')}</span>
      <select class="anim-speed-select" data-action="speed" aria-label="播放速度">
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
    `;

    const animContainer = this.container.querySelector('.anim-container') || this.container;
    const existingControls = animContainer.querySelector('.anim-controls');
    if (existingControls) existingControls.remove();

    animContainer.appendChild(controls);

    // Bind events
    controls.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        switch (action) {
          case 'toggle': this.player.toggle(); break;
          case 'play': this.player.play(); break;
          case 'pause': this.player.pause(); break;
          case 'step': this.player.step(); break;
          case 'stepBack': this.player.stepBack(); break;
          case 'reset':
            // 优先调用viz自身的reset（清理残留节点），其内部会再调player.reset()
            if (this.viz && typeof this.viz.reset === 'function') this.viz.reset();
            else this.player.reset();
            break;
        }
        this._updateUI();
      });
    });

    controls.querySelector('select[data-action="speed"]').addEventListener('change', (e) => {
      this.player.setSpeed(parseFloat(e.target.value));
    });

    // Listen to player state via polling in the tick loop
    // We wrap the player's tick to update UI on each step
    this._originalTick = this.player._tick.bind(this.player);
    this.player._tick = () => {
      this._updateUI();
      this._originalTick();
    };

    this._updateUI();
  }

  _updateUI() {
    const controls = this.container.querySelector('.anim-controls');
    if (!controls) return;

    const state = this.player.getState();
    const toggleBtn = controls.querySelector('[data-action="toggle"]');
    const playIcon = controls.querySelector('#play-icon');
    const stepInfo = controls.querySelector('#anim-step-info');

    if (playIcon) {
      playIcon.innerHTML = state.isPlaying
        ? '<rect x="5" y="3" width="4" height="18" fill="currentColor"/><rect x="15" y="3" width="4" height="18" fill="currentColor"/>'
        : '<polygon points="6 3 20 12 6 21" fill="currentColor"/>';
    }

    if (stepInfo) {
      stepInfo.textContent = this.stepFormat
        .replace('{current}', state.currentStep + 1)
        .replace('{total}', state.totalSteps);
    }
  }
}

window.AnimationControls = AnimationControls;
