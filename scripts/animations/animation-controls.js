/* ═══════════════════════════════════════════════════════════════
   animation-controls.js — 动画播放器UI控件
   为每个动画容器添加播放控制栏
   ═══════════════════════════════════════════════════════════════ */

class AnimationControls {
  /**
   * @param {AnimationPlayer} player - 动画播放器实例
   * @param {Object} options - 配置
   * @param {string} options.stepFormat - 步骤显示格式 '{current}/{total}'
   */
  constructor(player, options = {}) {
    this.player = player;
    this.stepFormat = options.stepFormat || '{current}/{total}';
    this.container = player.container;
    this._build();
  }

  _build() {
    const controls = document.createElement('div');
    controls.className = 'anim-controls';
    controls.innerHTML = `
      <button class="anim-btn" data-action="reset" aria-label="重置" title="重置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 12"/><path d="M3 5v7h7"/></svg>
      </button>
      <button class="anim-btn" data-action="stepBack" aria-label="上一步" title="上一步">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <button class="anim-btn primary" data-action="toggle" aria-label="播放/暂停" title="播放/暂停">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>
      </button>
      <button class="anim-btn" data-action="step" aria-label="下一步" title="下一步">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
      <span class="anim-step-info" id="anim-step-info">${this.stepFormat.replace('{current}', '0').replace('{total}', '1')}</span>
      <select class="anim-speed-select" data-action="speed" aria-label="播放速度">
        <option value="0.5">0.5x</option>
        <option value="1" selected>1x</option>
        <option value="1.5">1.5x</option>
        <option value="2">2x</option>
      </select>
    `;

    // Find the anim-container to append controls to
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
          case 'reset': this.player.reset(); break;
        }
        this._updateUI();
      });
    });

    controls.querySelector('select[data-action="speed"]').addEventListener('change', (e) => {
      this.player.setSpeed(parseFloat(e.target.value));
    });

    // Listen to player state changes
    this._updateHandler = () => this._updateUI();
    this.player.onStep = (i) => {
      this._updateUI();
      if (this.player._originalOnStep) this.player._originalOnStep(i);
    };

    this._updateUI();
  }

  _updateUI() {
    const controls = this.container.querySelector('.anim-controls');
    if (!controls) return;

    const state = this.player.getState();
    const toggleBtn = controls.querySelector('[data-action="toggle"]');
    const stepInfo = controls.querySelector('#anim-step-info');

    if (toggleBtn) {
      toggleBtn.innerHTML = state.isPlaying
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21"/></svg>';
    }

    if (stepInfo) {
      stepInfo.textContent = this.stepFormat
        .replace('{current}', state.currentStep + 1)
        .replace('{total}', state.totalSteps);
    }
  }
}

window.AnimationControls = AnimationControls;
