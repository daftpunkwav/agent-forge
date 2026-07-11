/* ═══════════════════════════════════════════════════════════════
   mcp-viz.js — MCP（Model Context Protocol）可视化动画
   展示：Client → Server 的资源/工具/提示通信流程
   ═══════════════════════════════════════════════════════════════ */

class McpAnimation {
  constructor(containerEl) {
    this.container = containerEl;
    this.steps = [
      { label: '初始化', desc: 'Client 连接到 MCP Server', type: 'connect' },
      { label: '发送请求', desc: 'Client 发送 tools/list 请求', type: 'request' },
      { label: '返回工具列表', desc: 'Server 返回可用工具列表', type: 'tools', items: ['search_web', 'calculate', 'read_file'] },
      { label: '发送资源请求', desc: 'Client 请求 resources/list', type: 'request' },
      { label: '返回资源列表', desc: 'Server 返回可用资源', type: 'resources', items: ['config.json', 'schema.yaml'] },
      { label: '调用工具', desc: 'Client 调用 search_web 工具', type: 'call' },
      { label: '返回结果', desc: 'Server 返回工具执行结果', type: 'result' },
      { label: '完成', desc: 'MCP通信流程演示完成', type: 'done' },
    ];
    this._build();
  }

  _build() {
    this.container.innerHTML = `
      <div style="padding: 20px;">
        <div style="text-align:center; margin-bottom:16px; font:600 12px/1 var(--font-mono); color:var(--muted-foreground); letter-spacing:0.05em; text-transform:uppercase;">
          MCP 协议 — 模型与外部世界的桥梁
        </div>
        <div class="mcp-layout" id="mcp-layout" style="display:grid; grid-template-columns:1fr auto 1fr; gap:20px; align-items:center; min-height:280px;">
          <!-- Client Side -->
          <div style="text-align:center;">
            <div style="font:700 13px/1 var(--font-mono); color:var(--primary); margin-bottom:10px;">LLM Client</div>
            <div id="mcp-client-area" style="min-height:200px; border:1.5px dashed var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:6px; align-items:center;">
              <div style="font:700 13px/1 var(--font-mono); color:var(--primary);">LLM Client</div>
              <div style="font-size:12px; color:var(--muted-foreground);">等待连接...</div>
            </div>
          </div>

          <!-- Connection -->
          <div style="display:flex; flex-direction:column; align-items:center; gap:2px; padding: 0 8px;">
            <div id="mcp-line-1" style="width:2px; height:50px; background:var(--border); border-radius:1px; transition:all 0.3s;"></div>
            <div id="mcp-pkt-1" style="width:6px; height:6px; border-radius:50%; background:var(--primary); opacity:0; transition:all 0.3s; font-size:9px; color:var(--primary);">↑</div>
            <div id="mcp-pkt-2" style="width:6px; height:6px; border-radius:50%; background:var(--chart-2); opacity:0; transition:all 0.3s; font-size:9px; color:var(--chart-2);">↓</div>
            <div id="mcp-line-2" style="width:2px; height:50px; background:var(--border); border-radius:1px; transition:all 0.3s;"></div>
            <div style="font:700 10px/1 var(--font-mono); color:var(--muted-foreground); margin-top:4px;">MCP</div>
          </div>

          <!-- Server Side -->
          <div style="text-align:center;">
            <div style="font:700 13px/1 var(--font-mono); color:var(--chart-2); margin-bottom:10px;">MCP Server</div>
            <div id="mcp-server-area" style="min-height:200px; border:1.5px dashed var(--border); border-radius:12px; padding:12px; display:flex; flex-direction:column; gap:6px; align-items:center;">
              <div style="font:700 13px/1 var(--font-mono); color:var(--chart-2);">MCP Server</div>
              <div style="font-size:12px; color:var(--muted-foreground);">等待请求...</div>
            </div>
          </div>
        </div>
        <div style="margin-top:16px; text-align:center; font-size:13px; color:var(--muted-foreground); min-height:20px;" id="mcp-desc">
          点击播放按钮，观看MCP协议如何连接LLM与外部工具
        </div>
      </div>
    `;

    this.player = new AnimationPlayer(this.container, {
      totalSteps: this.steps.length + 1,
      loop: true,
      autoPlayDelay: 1600,
      onStep: (i) => this._renderStep(i),
      onComplete: () => {}
    });
  }

  _renderStep(step) {
    const clientArea = this.container.querySelector('#mcp-client-area');
    const serverArea = this.container.querySelector('#mcp-server-area');
    const desc = this.container.querySelector('#mcp-desc');
    const line1 = this.container.querySelector('#mcp-line-1');
    const line2 = this.container.querySelector('#mcp-line-2');
    const pkt1 = this.container.querySelector('#mcp-pkt-1');
    const pkt2 = this.container.querySelector('#mcp-pkt-2');
    if (!clientArea || !serverArea) return;

    if (step === 0) {
      clientArea.innerHTML = '<div style="font:600 11px/1 var(--font-mono); color:var(--primary);">CLIENT</div><div style="font-size:12px; color:var(--muted-foreground);">等待连接...</div>';
      serverArea.innerHTML = '<div style="font:600 11px/1 var(--font-mono); color:var(--chart-2);">SERVER</div><div style="font-size:12px; color:var(--muted-foreground);">等待请求...</div>';
      line1.style.background = 'var(--border)'; line2.style.background = 'var(--border)';
      pkt1.style.opacity = '0'; pkt2.style.opacity = '0';
      if (desc) desc.textContent = '点击播放按钮，观看MCP协议如何连接LLM与外部工具';
      return;
    }

    const data = this.steps[step - 1];

    switch (data.type) {
      case 'connect':
        line1.style.background = 'var(--chart-3)'; line2.style.background = 'var(--chart-3)';
        pkt1.style.opacity = '0.6'; pkt2.style.opacity = '0.6';
        clientArea.innerHTML = '<div style="font:600 12px/1 var(--font-mono); color:var(--chart-3);">已连接</div>';
        serverArea.innerHTML = '<div style="font:600 12px/1 var(--font-mono); color:var(--chart-3);">就绪</div>';
        break;
      case 'request':
        clientArea.innerHTML += this._msgBubble('→ tools/list', 'outgoing');
        pkt1.style.opacity = '1';
        break;
      case 'tools':
        serverArea.innerHTML += this._msgBubble('← tools/list', 'incoming');
        serverArea.innerHTML += `<div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center;">${data.items.map(t =>
          `<span class="tag tag-muted" style="font-size:10px; padding:2px 8px;">${t}</span>`
        ).join('')}</div>`;
        pkt2.style.opacity = '1';
        break;
      case 'resources':
        serverArea.innerHTML += `<div style="display:flex; flex-wrap:wrap; gap:4px; justify-content:center;">${data.items.map(t =>
          `<span class="tag tag-secondary" style="font-size:10px; padding:2px 8px;">${t}</span>`
        ).join('')}</div>`;
        break;
      case 'call':
        clientArea.innerHTML += this._msgBubble('→ tools/call', 'outgoing');
        pkt1.style.opacity = '1';
        break;
      case 'result':
        serverArea.innerHTML += this._msgBubble('← result', 'incoming');
        serverArea.innerHTML += '<div style="font:11px/1.5 var(--font-mono); color:var(--chart-3); padding:6px; background:var(--muted); border-radius:6px;">{"result": "success"}</div>';
        pkt2.style.opacity = '1';
        break;
      case 'done':
        pkt1.style.opacity = '0.3'; pkt2.style.opacity = '0.3';
        break;
    }

    if (desc && data.desc) desc.textContent = data.desc;
  }

  _msgBubble(text, type) {
    const color = type === 'outgoing' ? 'var(--primary)' : 'var(--chart-2)';
    return `<div style="font:400 11px/1.3 var(--font-mono); color:${color}; padding:4px 8px; background:var(--muted); border-radius:6px; margin-top:4px;">${text}</div>`;
  }

  play() { this.player?.play(); }
  pause() { this.player?.pause(); }
  step() { this.player?.step(); }
  reset() {
    this._renderStep(0);
    this.player?.reset();
  }
}

window.McpAnimation = McpAnimation;
