/* ═══════════════════════════════════════════════════════════════
   react-viz.js — ReAct模式交互式动画可视化
   展示：Thought → Action → Observation 的交替循环
   ═══════════════════════════════════════════════════════════════ */

class ReactAnimation {
  constructor(containerEl) {
    this.container = containerEl;
    this.steps = [
      { label: '用户提问', type: 'input' },
      { label: 'Thought 1: 分析问题', type: 'thought' },
      { label: 'Action: 调用搜索工具', type: 'action' },
      { label: 'Observation: 搜索结果', type: 'observation' },
      { label: 'Thought 2: 分析结果', type: 'thought' },
      { label: 'Action: 调用计算工具', type: 'action' },
      { label: 'Observation: 计算结果', type: 'observation' },
      { label: 'Thought 3: 综合推理', type: 'thought' },
      { label: 'Answer: 最终答案', type: 'answer' },
    ];
    this.currentStep = 0;
    this.player = null;
    this.nodes = [];
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          ReAct 模式 — 推理与行动的交替循环
        </div>
        <div class="react-layout" id="react-layout-${this._id()}" style="position:relative; min-height:300px;">
          <div class="react-thought-col" id="react-thoughts-${this._id()}" style="display:flex; flex-direction:column; gap:8px; justify-content:center;">
          </div>
          <div class="react-action-col" id="react-actions-${this._id()}" style="display:flex; flex-direction:column; align-items:center; gap:4px; justify-content:center;">
            <div style="font:600 11px/1 var(--font-mono); color:var(--primary); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">THOUGHT</div>
            <div style="width:40px; height:2px; background:var(--border); position:relative; margin:4px 0;">
            </div>
            <div style="font:600 11px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">ACTION</div>
            <div style="width:40px; height:2px; background:var(--border); position:relative; margin:4px 0;">
            </div>
            <div style="font:600 11px/1 var(--font-mono); color:var(--chart-2); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">OBS</div>
            <div style="width:40px; height:2px; background:var(--border); position:relative; margin:4px 0;">
            </div>
            <div style="font:600 11px/1 var(--font-mono); color:var(--chart-3); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">ANSWER</div>
          </div>
          <div class="react-result-col" id="react-results-${this._id()}" style="display:flex; flex-direction:column; gap:8px; justify-content:center;">
          </div>
        </div>
        <div style="margin-top:16px; text-align:center; font-size:13px; color:var(--muted-foreground);" id="react-desc-${this._id()}">
          点击 ▶ 播放动画，观察 ReAct 如何交替进行推理与行动
        </div>
      </div>
    `;

    this._id_val = this._id();

    this.player = new AnimationPlayer(this.container, {
      totalSteps: this.steps.length,
      loop: false,
      onStep: (i) => this._renderStep(i),
      onComplete: () => this._onComplete()
    });

    this._attachControls();
    this._renderStep(0);
  }

  _id() {
    return Math.random().toString(36).substr(2, 6);
  }

  _attachControls() {
    // Controls are attached externally via animation-player integration
  }

  _renderStep(step) {
    const layout = this.container.querySelector(`#react-layout-${this._id_val}`);
    if (!layout) return;

    const data = this.steps[step];
    if (!data) return;

    const descEl = this.container.querySelector(`#react-desc-${this._id_val}`);

    // Clear previous active bubbles
    const allBubbles = layout.querySelectorAll('.react-bubble');
    allBubbles.forEach(b => {
      if (data.type !== 'input') b.classList.remove('active');
    });

    // Remove old non-active bubbles
    allBubbles.forEach(b => {
      const bubbleStep = parseInt(b.dataset.step || '0');
      if (bubbleStep < step && !b.classList.contains('done')) {
        b.classList.add('done');
      }
    });

    const thoughtCol = layout.querySelector(`#react-thoughts-${this._id_val}`);
    const resultCol = layout.querySelector(`#react-results-${this._id_val}`);

    switch (data.type) {
      case 'input':
        if (descEl) descEl.textContent = '用户向Agent提出一个问题';
        break;
      case 'thought':
        this._addBubble(thoughtCol, data.label, 'thought', step);
        if (descEl) descEl.textContent = '💭 Agent正在思考：' + data.label.replace('Thought 1: ', '').replace('Thought 2: ', '').replace('Thought 3: ', '');
        break;
      case 'action':
        this._addBubble(resultCol, data.label, 'action', step);
        if (descEl) descEl.textContent = '⚡ Agent决定执行行动：' + data.label.replace('Action: ', '');
        break;
      case 'observation':
        this._addBubble(thoughtCol, data.label, 'observation', step);
        if (descEl) descEl.textContent = '👁️ 工具返回了观察结果';
        break;
      case 'answer':
        this._addBubble(thoughtCol, data.label, 'answer', step);
        if (descEl) descEl.textContent = '✅ Agent给出了最终答案';
        break;
    }
  }

  _addBubble(col, text, type, step) {
    const bubble = document.createElement('div');
    bubble.className = `react-bubble ${type}`;
    bubble.dataset.step = step;
    bubble.textContent = text;
    if (type === 'thought' || type === 'observation') {
      bubble.style.textAlign = 'left';
    }
    col.appendChild(bubble);
    // Trigger animation
    requestAnimationFrame(() => {
      bubble.classList.add('visible');
    });
  }

  _onComplete() {
    const descEl = this.container.querySelector(`#react-desc-${this._id_val}`);
    if (descEl) descEl.textContent = '🎉 ReAct循环完成！Agent通过推理和行动的交替循环找到了答案。';
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    this.currentStep = 0;
    const layout = this.container.querySelector(`#react-layout-${this._id_val}`);
    if (layout) {
      layout.querySelectorAll('.react-bubble').forEach(b => b.remove());
    }
    this.player?.reset();
    const descEl = this.container.querySelector(`#react-desc-${this._id_val}`);
    if (descEl) descEl.textContent = '点击 ▶ 播放动画，观察 ReAct 如何交替进行推理与行动';
  }
}

window.ReactAnimation = ReactAnimation;
