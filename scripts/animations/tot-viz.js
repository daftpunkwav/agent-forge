/* ═══════════════════════════════════════════════════════════════
   tot-viz.js — ToT（Tree of Thoughts）思维树可视化动画
   展示：问题 → 候选方案 → 评估打分 → 剪枝 → 最优路径
   ═══════════════════════════════════════════════════════════════ */

class TotAnimation {
  constructor(containerEl) {
    this.container = containerEl;
    this.width = 600;
    this.height = 420;
    this.steps = [
      { label: '问题输入', type: 'root', x: 300, y: 30, text: '如何提升网站日活？' },
      { label: '方案A', type: 'candidate', x: 140, y: 120, text: '优化SEO' },
      { label: '方案B', type: 'candidate', x: 300, y: 120, text: '推送通知' },
      { label: '方案C', type: 'candidate', x: 460, y: 120, text: '社交裂变' },
      { label: '评估A', type: 'evaluate', x: 140, y: 200, text: '效果: 3/5' },
      { label: '评估B', type: 'evaluate', x: 300, y: 200, text: '效果: 4/5' },
      { label: '评估C', type: 'evaluate', x: 460, y: 200, text: '效果: 2/5' },
      { label: '剪枝C', type: 'prune', x: 460, y: 280, text: '❌ 成本过高' },
      { label: '扩展A', type: 'expand', x: 200, y: 300, text: '长尾关键词' },
      { label: '扩展B', type: 'expand', x: 400, y: 300, text: '个性化推送' },
      { label: '最优', type: 'selected', x: 300, y: 380, text: '✓ 推送通知 + 个性化' },
    ];
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          ToT 思维树 — 探索多路径并选择最优解
        </div>
        <div style="position:relative; width:100%; max-width:${this.width}px; margin:0 auto;">
          <svg width="100%" height="${this.height}" viewBox="0 0 ${this.width} ${this.height}" id="tot-svg" style="overflow:visible;">
            ${this._edges()}
          </svg>
          <div id="tot-nodes-layer" style="position:absolute; top:0; left:50%; transform:translateX(-50%); width:${this.width}px; height:${this.height}px; pointer-events:none;">
          </div>
        </div>
        <div style="margin-top:16px; text-align:center; font-size:13px; color:var(--muted-foreground); min-height:20px;" id="tot-desc">
          点击 ▶ 观看ToT如何探索多种方案并找到最优解
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

  _edges() {
    // Pre-build all SVG edges (hidden initially)
    const edges = [
      [0, 1], [0, 2], [0, 3],
      [1, 4], [2, 5], [3, 6],
      [5, 8], [5, 9],
    ];
    return edges.map(([from, to]) => {
      const f = this.steps[from];
      const t = this.steps[to];
      return `<line class="tot-edge" id="tot-edge-${from}-${to}" x1="${f.x}" y1="${f.y + 20}" x2="${t.x}" y2="${t.y - 20}"/>`;
    }).join('');
  }

  _renderStep(step) {
    const nodesLayer = this.container.querySelector('#tot-nodes-layer');
    const desc = this.container.querySelector('#tot-desc');
    if (!nodesLayer) return;

    // Add nodes up to current step
    while (nodesLayer.children.length < step && step <= this.steps.length) {
      const idx = nodesLayer.children.length;
      const data = this.steps[idx];
      const node = document.createElement('div');
      node.className = `tot-node ${data.type}`;
      node.style.left = (data.x - 60) + 'px';
      node.style.top = data.y + 'px';
      node.style.pointerEvents = 'auto';

      if (data.type === 'evaluate') {
        node.innerHTML = `<div>${data.text}</div><div class="tot-score">${this._score(idx)}</div>`;
      } else {
        node.textContent = data.text;
      }

      nodesLayer.appendChild(node);
      requestAnimationFrame(() => node.classList.add('visible'));

      // Animate score badge with delay
      if (data.type === 'evaluate') {
        setTimeout(() => {
          const score = node.querySelector('.tot-score');
          if (score) score.classList.add('visible');
        }, 300);
      }
    }

    // Activate edges
    const edgePairs = [[0,1],[0,2],[0,3],[1,4],[2,5],[3,6],[5,8],[5,9]];
    edgePairs.forEach(([from, to]) => {
      const edge = this.container.querySelector(`#tot-edge-${from}-${to}`);
      if (edge && to < step) edge.classList.add('active');
    });

    // Mark previous steps as done
    const allNodes = nodesLayer.querySelectorAll('.tot-node');
    allNodes.forEach((n, i) => {
      if (i < step - 1 && !n.classList.contains('done')) {
        n.classList.add('done');
      }
    });

    if (step > 0 && step <= this.steps.length) {
      const data = this.steps[step - 1];
      const messages = {
        'root': '📌 定义核心问题',
        'candidate': '💡 生成候选方案',
        'evaluate': '📊 评估每个方案的效果',
        'prune': '✂️ 剪枝：淘汰不达标方案C',
        'expand': '🌿 对优质方案深入展开',
        'selected': '🏆 找到最优路径！',
      };
      desc.textContent = messages[data.type] || data.label;
    }
  }

  _score(idx) {
    const scores = ['', '', '', '', '3/5', '4/5', '2/5', '', '', ''];
    return scores[idx] || '';
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    const nodesLayer = this.container.querySelector('#tot-nodes-layer');
    if (nodesLayer) nodesLayer.innerHTML = '';
    const svg = this.container.querySelector('#tot-svg');
    if (svg) {
      svg.querySelectorAll('.tot-edge').forEach(e => {
        e.classList.remove('active');
      });
    }
    const desc = this.container.querySelector('#tot-desc');
    if (desc) desc.textContent = '点击 ▶ 观看ToT如何探索多种方案并找到最优解';
    this.player?.reset();
  }
}

window.TotAnimation = TotAnimation;
