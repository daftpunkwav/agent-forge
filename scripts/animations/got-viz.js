/* ═══════════════════════════════════════════════════════════════
   got-viz.js — GoT（Graph of Thoughts）图谱思维可视化动画
   展示：实体提取 → 关系识别 → 图谱构建
   ═══════════════════════════════════════════════════════════════ */

class GotAnimation {
  constructor(containerEl) {
    this.container = containerEl;
    this.entities = [
      { id: 'e1', label: 'Alice', type: '人物', x: 120, y: 60 },
      { id: 'e2', label: 'Bob', type: '人物', x: 320, y: 40 },
      { id: 'e3', label: 'Google', type: '公司', x: 500, y: 80 },
      { id: 'e4', label: 'Python', type: '技术', x: 80, y: 180 },
      { id: 'e5', label: 'AI Engineer', type: '职位', x: 240, y: 200 },
      { id: 'e6', label: 'Machine Learning', type: '领域', x: 400, y: 180 },
      { id: 'e7', label: 'OpenAI', type: '公司', x: 560, y: 160 },
    ];
    this.relations = [
      { from: 'e1', to: 'e2', label: '同事' },
      { from: 'e1', to: 'e3', label: '前雇主' },
      { from: 'e2', to: 'e7', label: '工作于' },
      { from: 'e4', to: 'e5', label: '使用' },
      { from: 'e5', to: 'e6', label: '研究' },
      { from: 'e6', to: 'e7', label: '开发' },
    ];
    this._build();
  }

  _build() {
    const w = 640, h = 280;
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          GoT 图谱思维 — 从文本构建知识图谱
        </div>
        <div style="position:relative; width:100%; max-width:${w}px; margin:0 auto;">
          <svg width="100%" height="${h}" viewBox="0 0 ${w} ${h}" id="got-svg" style="overflow:visible;">
          </svg>
        </div>
        <div style="margin-top:16px; text-align:center; font-size:13px; color:var(--muted-foreground); min-height:20px;" id="got-desc">
          点击播放按钮，观察Agent如何从文本中提取实体并构建关系图谱
        </div>
      </div>
    `;

    this.svg = this.container.querySelector('#got-svg');
    // Create a nodes overlay layer inside the relative-positioned wrapper
    const wrapper = this.container.querySelector('div[style*="position:relative"]');
    if (wrapper) {
      this.nodesLayer = document.createElement('div');
      this.nodesLayer.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;';
      wrapper.appendChild(this.nodesLayer);
    } else {
      this.nodesLayer = null;
    }
    this._drawEdges();

    this.player = new AnimationPlayer(this.container, {
      totalSteps: this.entities.length + this.relations.length + 1,
      loop: true,
      onStep: (i) => this._renderStep(i),
      onComplete: () => {
        const desc = this.container.querySelector('#got-desc');
        if (desc) desc.textContent = '图谱构建完成！Agent从文本中提取了7个实体和6个关系。';
      }
    });
  }

  _drawEdges() {
    const drawn = new Set();
    this.relations.forEach((rel, idx) => {
      const from = this.entities.find(e => e.id === rel.from);
      const to = this.entities.find(e => e.id === rel.to);
      const key = `${rel.from}-${rel.to}`;
      if (drawn.has(key)) return;
      drawn.add(key);

      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'got-relation');
      line.setAttribute('id', `got-rel-${idx}`);
      line.setAttribute('x1', from.x + 25);
      line.setAttribute('y1', from.y + 20);
      line.setAttribute('x2', to.x + 25);
      line.setAttribute('y2', to.y + 20);
      this.svg.appendChild(line);

      const midX = (from.x + to.x) / 2 + 25;
      const midY = (from.y + to.y) / 2 + 20;
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('class', 'got-label');
      text.setAttribute('id', `got-label-${idx}`);
      text.setAttribute('x', midX);
      text.setAttribute('y', midY - 6);
      text.textContent = rel.label;
      this.svg.appendChild(text);
    });
  }

  _renderStep(step) {
    const desc = this.container.querySelector('#got-desc');
    if (!desc) return;

    if (step <= this.entities.length) {
      const idx = step - 1;
      if (idx >= 0 && idx < this.entities.length) {
        const ent = this.entities[idx];
        const node = document.createElement('div');
        node.className = 'got-entity';
        node.style.left = ent.x + 'px';
        node.style.top = ent.y + 'px';
        node.textContent = ent.label;
        node.dataset.id = ent.id;
        const nodesLayer = this.nodesLayer;
        if (nodesLayer) {
          nodesLayer.appendChild(node);
          requestAnimationFrame(() => node.classList.add('visible'));
        }
        desc.textContent = `提取实体：${ent.label}（${ent.type}）`;
      }
    } else if (step <= this.entities.length + this.relations.length) {
      const relIdx = step - this.entities.length - 1;
      if (relIdx >= 0 && relIdx < this.relations.length) {
        const rel = this.relations[relIdx];
        const edge = this.container.querySelector(`#got-rel-${relIdx}`);
        const label = this.container.querySelector(`#got-label-${relIdx}`);
        if (edge) edge.classList.add('highlighted');
        if (label) { label.style.fill = 'var(--primary)'; label.style.fontWeight = '600'; }
        desc.textContent = `发现关系：${rel.from} → ${rel.label} → ${rel.to}`;
      }
    }
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    const nodesLayer = this.nodesLayer;
    if (nodesLayer) nodesLayer.innerHTML = '';
    this.svg.querySelectorAll('.got-relation').forEach(e => e.classList.remove('highlighted'));
    this.svg.querySelectorAll('.got-label').forEach(e => {
      e.style.fill = '';
      e.style.fontWeight = '';
    });
    const desc = this.container.querySelector('#got-desc');
    if (desc) desc.textContent = '点击播放按钮，观察Agent如何从文本中提取实体并构建关系图谱';
    this.player?.reset();
  }
}

window.GotAnimation = GotAnimation;
