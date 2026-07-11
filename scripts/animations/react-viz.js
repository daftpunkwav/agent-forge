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
    this.uid = 'r' + Math.random().toString(36).substr(2, 6);
    this._build();
  }

  _build() {
    const uid = this.uid;
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          ReAct 模式 — 推理与行动的交替循环
        </div>
        <div class="react-layout" id="react-layout-${uid}" style="position:relative; min-height:300px;">
          <div class="react-thought-col" id="react-thoughts-${uid}" style="display:flex; flex-direction:column; gap:8px; justify-content:center;">
          </div>
          <div class="react-action-col" id="react-actions-${uid}" style="display:flex; flex-direction:column; align-items:center; gap:4px; justify-content:center;">
            <div style="font:600 11px/1 var(--font-mono); color:var(--primary); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">THOUGHT</div>
            <div style="width:40px; height:2px; background:var(--border); position:relative; margin:4px 0;"></div>
            <div style="font:600 11px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">ACTION</div>
            <div style="width:40px; height:2px; background:var(--border); position:relative; margin:4px 0;"></div>
            <div style="font:600 11px/1 var(--font-mono); color:var(--chart-2); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">OBS</div>
            <div style="width:40px; height:2px; background:var(--border); position:relative; margin:4px 0;"></div>
            <div style="font:600 11px/1 var(--font-mono); color:var(--chart-3); letter-spacing:0.08em; text-transform:uppercase; writing-mode:vertical-rl;">ANSWER</div>
          </div>
          <div class="react-result-col" id="react-results-${uid}" style="display:flex; flex-direction:column; gap:8px; justify-content:center;">
          </div>
        </div>
        <div style="margin-top:16px; text-align:center; font-size:13px; color:var(--muted-foreground);" id="react-desc-${uid}">
          点击播放按钮，观察 ReAct 如何交替进行推理与行动
        </div>
      </div>
    `;

    this.player = new AnimationPlayer(this.container, {
      totalSteps: this.steps.length,
      loop: false,
      onStep: (i) => this._renderStep(i),
      onComplete: () => this._onComplete()
    });

    this._renderStep(0);
  }

  _renderStep(step) {
    const layout = this.container.querySelector(`#react-layout-${this.uid}`);
    if (!layout) return;

    const data = this.steps[step];
    if (!data) return;

    const descEl = this.container.querySelector(`#react-desc-${this.uid}`);

    // 标记旧气泡为done
    const allBubbles = layout.querySelectorAll('.react-bubble');
    allBubbles.forEach(b => {
      const bubbleStep = parseInt(b.dataset.step || '0');
      if (bubbleStep < step) {
        b.classList.add('done');
        b.classList.remove('active');
      }
    });

    const thoughtCol = layout.querySelector(`#react-thoughts-${this.uid}`);
    const resultCol = layout.querySelector(`#react-results-${this.uid}`);

    const descriptions = {
      input: '用户向Agent提出一个问题',
      thought: data.label.replace(/Thought \d+: /, ''),
      action: data.label.replace('Action: ', ''),
      observation: '工具返回了观察结果',
      answer: 'Agent给出了最终答案'
    };
    if (descEl) descEl.textContent = descriptions[data.type] || '';

    switch (data.type) {
      case 'input':
        // 无气泡，仅显示描述
        break;
      case 'thought':
        this._addBubble(thoughtCol, data.label, 'thought', step);
        break;
      case 'action':
        this._addBubble(resultCol, data.label, 'action', step);
        break;
      case 'observation':
        this._addBubble(thoughtCol, data.label, 'observation', step);
        break;
      case 'answer':
        this._addBubble(thoughtCol, data.label, 'answer', step);
        break;
    }
  }

  _addBubble(col, text, type, step) {
    if (!col) return;
    const bubble = document.createElement('div');
    bubble.className = `react-bubble ${type}`;
    bubble.dataset.step = step;
    bubble.textContent = text;
    col.appendChild(bubble);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bubble.classList.add('visible');
      });
    });
  }

  _onComplete() {
    const descEl = this.container.querySelector(`#react-desc-${this.uid}`);
    if (descEl) descEl.textContent = 'ReAct 循环完成！Agent 通过推理与行动的交替循环找到了答案。';
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    const layout = this.container.querySelector(`#react-layout-${this.uid}`);
    if (layout) {
      layout.querySelectorAll('.react-bubble').forEach(b => b.remove());
    }
    this.player?.reset();
    const descEl = this.container.querySelector(`#react-desc-${this.uid}`);
    if (descEl) descEl.textContent = '点击播放按钮，观察 ReAct 如何交替进行推理与行动';
  }
}

window.ReactAnimation = ReactAnimation;
