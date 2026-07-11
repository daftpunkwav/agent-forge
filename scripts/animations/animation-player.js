/* ═══════════════════════════════════════════════════════════════
   animation-player.js — AgentForge 动画播放器核心
   支持：播放/暂停/步进/重置/跳转/速度控制
   ═══════════════════════════════════════════════════════════════ */

class AnimationPlayer {
  /**
   * @param {HTMLElement} container - 动画容器元素
   * @param {Object} config - 配置
   * @param {number} config.totalSteps - 总步数
   * @param {number} config.speed - 播放速度倍率 (默认1)
   * @param {boolean} config.loop - 是否循环播放
   * @param {Function} config.onStep - 每步回调 (stepIndex) => void
   * @param {Function} config.onComplete - 完成回调 () => void
   */
  constructor(container, config = {}) {
    this.container = container;
    this.totalSteps = config.totalSteps || 1;
    this.speed = config.speed || 1;
    this.loop = config.loop || false;
    this.currentStep = 0;
    this.isPlaying = false;
    this.intervalId = null;
    this.autoPlayDelay = 1800; // ms between steps
    this.onStep = config.onStep || (() => {});
    this.onComplete = config.onComplete || (() => {});
  }

  play() {
    if (this.isPlaying) return;
    if (this.currentStep >= this.totalSteps) {
      this.currentStep = 0;
    }
    this.isPlaying = true;
    this._tick();
  }

  pause() {
    this.isPlaying = false;
    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  step() {
    this.pause();
    this._advance();
  }

  stepBack() {
    this.pause();
    if (this.currentStep > 0) {
      this.currentStep--;
      this.onStep(this.currentStep);
    }
  }

  reset() {
    this.pause();
    this.currentStep = 0;
    this.onStep(0);
  }

  goTo(step) {
    this.pause();
    this.currentStep = Math.max(0, Math.min(step, this.totalSteps - 1));
    this.onStep(this.currentStep);
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  getState() {
    return {
      currentStep: this.currentStep,
      totalSteps: this.totalSteps,
      isPlaying: this.isPlaying,
      speed: this.speed,
      progress: this.totalSteps > 0 ? this.currentStep / (this.totalSteps - 1) : 0
    };
  }

  destroy() {
    this.pause();
    this.onStep = () => {};
    this.onComplete = () => {};
  }

  _tick() {
    if (!this.isPlaying) return;
    this._advance();
    const delay = this.autoPlayDelay / this.speed;
    this.intervalId = setTimeout(() => this._tick(), delay);
  }

  _advance() {
    this.onStep(this.currentStep);
    if (this.currentStep >= this.totalSteps - 1) {
      if (this.loop) {
        this.currentStep = 0;
      } else {
        this.isPlaying = false;
        this.onComplete();
        return;
      }
    }
    this.currentStep++;
  }
}

// 导出为全局
window.AnimationPlayer = AnimationPlayer;
