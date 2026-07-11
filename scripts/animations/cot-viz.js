/* ═══════════════════════════════════════════════════════════════
   cot-viz.js — CoT（Chain of Thought）思维链可视化动画
   ═══════════════════════════════════════════════════════════════ */

class CotAnimation {
  constructor(containerEl) {
    this.container = containerEl;
    this.steps = [
      { number: 'Q', label: '问题：一个农场有鸡和兔子共35只，总共有94条腿，鸡和兔子各几只？', highlight: false },
      { number: '1', label: '假设全是鸡 → 35 × 2 = 70 条腿', highlight: true },
      { number: '2', label: '实际94条腿，少了 94 - 70 = 24 条腿', highlight: true },
      { number: '3', label: '每只兔子比鸡多2条腿 → 24 ÷ 2 = 12 只兔子', highlight: true },
      { number: '4', label: '鸡的数量：35 - 12 = 23 只', highlight: true },
      { number: 'A', label: '答案：兔子12只，鸡23只。验证：12×4 + 23×2 = 48+46 = 94 ✓', highlight: false },
    ];
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          CoT 思维链 — 逐步推理过程
        </div>
        <div class="cot-chain" id="cot-chain" style="position:relative; padding-left:36px;">
        </div>
        <div style="margin-top:20px; text-align:center; font-size:13px; color:var(--muted-foreground); min-height:20px;" id="cot-desc">
          点击 ▶ 逐步观察Agent如何一步步推理出答案
        </div>
      </div>
    `;

    this.player = new AnimationPlayer(this.container, {
      totalSteps: this.steps.length + 1,
      loop: true,
      onStep: (i) => this._renderStep(i),
      onComplete: () => {}
    });
  }

  _renderStep(step) {
    const chain = this.container.querySelector('#cot-chain');
    const desc = this.container.querySelector('#cot-desc');
    if (!chain) return;

    // Show steps up to current
    while (chain.children.length < step && step <= this.steps.length) {
      const idx = chain.children.length;
      const data = this.steps[idx];
      const stepEl = document.createElement('div');
      stepEl.className = 'cot-step';
      stepEl.innerHTML = `
        <div class="cot-step-number">步骤 ${data.number}</div>
        <div class="cot-step-content">${data.label}</div>
      `;
      chain.appendChild(stepEl);
      requestAnimationFrame(() => stepEl.classList.add('visible'));
    }

    if (step > 0 && step <= this.steps.length) {
      const allSteps = chain.querySelectorAll('.cot-step');
      allSteps.forEach((s, i) => {
        if (i < step - 1) s.classList.add('done');
        if (i === step - 1) s.classList.add('done');
      });
    }

    const data = step > 0 && step <= this.steps.length ? this.steps[step - 1] : null;
    if (data) {
      if (data.number === 'A') {
        desc.textContent = '🎯 推理完成！通过逐步推导，Agent得出了正确答案。';
      } else {
        desc.textContent = `📝 正在执行步骤 ${data.number}：${data.label}`;
      }
    }
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    const chain = this.container.querySelector('#cot-chain');
    if (chain) chain.innerHTML = '';
    const desc = this.container.querySelector('#cot-desc');
    if (desc) desc.textContent = '点击 ▶ 逐步观察Agent如何一步步推理出答案';
    this.player?.reset();
  }
}

window.CotAnimation = CotAnimation;
