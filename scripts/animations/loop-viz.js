/* ═══════════════════════════════════════════════════════════════
   loop-viz.js — Agent Loop循环可视化动画
   展示：Perceive → Reason → Act → Observe 循环流程
   ═══════════════════════════════════════════════════════════════ */

class LoopAnimation {
  constructor(containerEl) {
    this.container = containerEl;
    this.steps = [
      { label: 'Perceive', sub: '感知环境', icon: '👁', desc: '接收用户输入、传感器数据、上下文信息' },
      { label: 'Reason', sub: '推理规划', icon: '🧠', desc: '分析当前状态，决定下一步行动' },
      { label: 'Act', sub: '执行行动', icon: '⚡', desc: '调用工具、发送消息、修改状态' },
      { label: 'Observe', sub: '观察结果', icon: '📡', desc: '收集行动结果，更新记忆' },
    ];
    this.cycles = 3; // Show 3 loop iterations
    this.totalSteps = this.steps.length * this.cycles + 1;
    this._build();
  }

  _build() {
    const cx = 200, cy = 200, r = 130;
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          Agent Loop — 智能体的核心循环
        </div>
        <div style="display:flex; justify-content:center;">
          <div style="position:relative; width:400px; height:400px;">
            <svg width="400" height="400" viewBox="0 0 400 400" style="overflow:visible;">
              <!-- 循环轨道 -->
              <polygon points="${this._polygon(cx, cy, r)}"
                fill="none" stroke="var(--border)" stroke-width="2"
                stroke-dasharray="6 4" opacity="0.6"/>
              <!-- 箭头 -->
              ${this._arrows(cx, cy, r)}
            </svg>
            ${this.steps.map((s, i) => {
              const angle = this._angle(i);
              const x = cx + r * Math.cos(angle) - 55;
              const y = cy + r * Math.sin(angle) - 30;
              return `
                <div class="loop-step" id="loop-step-${i}"
                  style="left:${x}px; top:${y}px; width:110px; height:56px;">
                  <div class="loop-icon">${s.icon}</div>
                  <div style="font:700 12px/1 var(--font-sans);">${s.label}</div>
                  <div style="font:400 10px/1.3 var(--font-mono); color:var(--muted-foreground);">${s.sub}</div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        <div style="margin-top:16px; text-align:center; font-size:13px; color:var(--muted-foreground); min-height:20px;" id="loop-desc">
          点击 ▶ 观看Agent如何在循环中不断演进
        </div>
        <div style="margin-top:8px; display:flex; justify-content:center; gap:16px; font-size:12px; color:var(--muted-foreground);">
          <span>循环 1/3</span>
          <span id="loop-cycle-info"></span>
        </div>
      </div>
    `;

    this.player = new AnimationPlayer(this.container, {
      totalSteps: this.totalSteps,
      loop: true,
      autoPlayDelay: 1400,
      onStep: (i) => this._renderStep(i),
      onComplete: () => {
        const desc = this.container.querySelector('#loop-desc');
        if (desc) desc.textContent = '🏁 Agent循环演示完成。实际运行中循环会持续直到完成目标。';
      }
    });
  }

  _polygon(cx, cy, r) {
    return this.steps.map((_, i) => {
      const a = this._angle(i);
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    }).join(' ');
  }

  _arrows(cx, cy, r) {
    return this.steps.map((_, i) => {
      const a1 = this._angle(i);
      const a2 = this._angle((i + 1) % this.steps.length);
      const x1 = cx + r * Math.cos(a1);
      const y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2);
      const y2 = cy + r * Math.sin(a2);
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const angle = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
      return `<polygon points="0,-6 12,0 0,6"
        fill="var(--muted-foreground)" opacity="0.5"
        transform="translate(${mx - 2},${my - 2}) rotate(${angle + 90})"/>`;
    }).join('');
  }

  _angle(i) {
    return (i * Math.PI / 2) - Math.PI / 2;
  }

  _renderStep(step) {
    const desc = this.container.querySelector('#loop-desc');
    const cycleInfo = this.container.querySelector('#loop-cycle-info');

    if (step === 0) {
      if (desc) desc.textContent = 'Agent开始执行任务...';
      // Reset all steps
      this.steps.forEach((_, i) => {
        const el = this.container.querySelector(`#loop-step-${i}`);
        if (el) el.classList.remove('active', 'done');
      });
      return;
    }

    const cycleIdx = Math.floor((step - 1) / this.steps.length);
    const stepIdx = (step - 1) % this.steps.length;
    const data = this.steps[stepIdx];

    // Activate current step
    const stepEl = this.container.querySelector(`#loop-step-${stepIdx}`);
    if (stepEl) {
      stepEl.classList.add('active');
      // Mark previous in this cycle as done
      for (let i = 0; i < stepIdx; i++) {
        const prev = this.container.querySelector(`#loop-step-${i}`);
        if (prev) { prev.classList.remove('active'); prev.classList.add('done'); }
      }
    }

    if (cycleInfo) cycleInfo.textContent = `步骤: ${data.label} — ${data.desc}`;
    if (desc) desc.textContent = `🔄 循环 #${cycleIdx + 1}：${data.icon} ${data.label} — ${data.desc}`;
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    this.steps.forEach((_, i) => {
      const el = this.container.querySelector(`#loop-step-${i}`);
      if (el) el.classList.remove('active', 'done');
    });
    const desc = this.container.querySelector('#loop-desc');
    if (desc) desc.textContent = '点击 ▶ 观看Agent如何在循环中不断演进';
    const cycleInfo = this.container.querySelector('#loop-cycle-info');
    if (cycleInfo) cycleInfo.textContent = '';
    this.player?.reset();
  }
}

window.LoopAnimation = LoopAnimation;
