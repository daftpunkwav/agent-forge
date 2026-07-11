/* ═══════════════════════════════════════════════════════════════
   app.js — AgentForge SPA 主入口
   - 路由系统（hash-based）
   - 页面加载与注入
   - 全局初始化
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── 路由配置 ──
  const ROUTES = {
    '#/': 'pages/home.html',
    '#/login': 'pages/login.html',
    '#/register': 'pages/register.html',
    '#/settings': 'pages/settings.html',
    '#/profile': 'pages/profile.html',
    '#/knowledge': 'pages/knowledge/overview.html',
    '#/knowledge/react': 'pages/knowledge/react.html',
    '#/knowledge/cot': 'pages/knowledge/cot.html',
    '#/knowledge/got': 'pages/knowledge/got.html',
    '#/knowledge/tot': 'pages/knowledge/tot.html',
    '#/knowledge/mcp': 'pages/knowledge/mcp.html',
    '#/knowledge/context': 'pages/knowledge/context.html',
    '#/knowledge/memory': 'pages/knowledge/memory.html',
    '#/knowledge/evaluation': 'pages/knowledge/evaluation.html',
    '#/knowledge/tool-use': 'pages/knowledge/tool-use.html',
    '#/knowledge/prompt-eng': 'pages/knowledge/prompt-eng.html',
    '#/knowledge/frameworks/langchain': 'pages/knowledge/frameworks/langchain.html',
    '#/knowledge/frameworks/autogen': 'pages/knowledge/frameworks/autogen.html',
    '#/knowledge/frameworks/crewai': 'pages/knowledge/frameworks/crewai.html',
    '#/llm/basics': 'pages/llm/basics.html',
    '#/llm/transformers': 'pages/llm/transformers.html',
    '#/llm/tokenization': 'pages/llm/tokenization.html',
    '#/llm/fine-tuning': 'pages/llm/fine-tuning.html',
    '#/llm/prompting': 'pages/llm/prompting.html',
    '#/news': 'pages/news.html',
    '#/author': 'pages/author/dashboard.html',
    '#/author/new': 'pages/author/dashboard.html',
    '#/author/apply': 'pages/author/apply.html',
  };

  // 路由→导航key映射
  const ROUTE_NAV_KEYS = {
    '#/': 'home',
    '#/login': 'home',
    '#/register': 'home',
    '#/settings': 'home',
    '#/profile': 'home',
    '#/knowledge': 'knowledge',
    '#/knowledge/react': 'knowledge',
    '#/knowledge/cot': 'knowledge',
    '#/knowledge/got': 'knowledge',
    '#/knowledge/tot': 'knowledge',
    '#/knowledge/mcp': 'knowledge',
    '#/knowledge/context': 'knowledge',
    '#/knowledge/memory': 'knowledge',
    '#/knowledge/evaluation': 'knowledge',
    '#/knowledge/tool-use': 'knowledge',
    '#/knowledge/prompt-eng': 'knowledge',
    '#/knowledge/frameworks/langchain': 'knowledge',
    '#/knowledge/frameworks/autogen': 'knowledge',
    '#/knowledge/frameworks/crewai': 'knowledge',
    '#/llm/basics': 'llm',
    '#/llm/transformers': 'llm',
    '#/llm/tokenization': 'llm',
    '#/llm/fine-tuning': 'llm',
    '#/llm/prompting': 'llm',
    '#/news': 'news',
    '#/author': 'home',
    '#/author/new': 'home',
    '#/author/apply': 'home',
  };

  // ── 全局状态 ──
  let themeManager = null;
  let currentRoute = '';

  // ── 初始化 ──
  function init() {
    themeManager = new ThemeManager();

    // 暴露到全局，供settings页面使用
    window.__THEME_MANAGER__ = themeManager;

    // 监听hash变化
    window.addEventListener('hashchange', handleRoute);

    // 初始路由
    handleRoute();

    // 初始化Agent浮动按钮
    initAgentFloat();

    // Header主题切换按钮
    const headerThemeBtn = document.querySelector('[data-theme-toggle]');
    if (headerThemeBtn) {
      headerThemeBtn.addEventListener('click', () => {
        themeManager.toggle();
        updateThemeIcons(themeManager.get());
      });
      updateThemeIcons(themeManager.get());
    }

    // 移动端菜单
    const mobileMenuBtn = document.querySelector('#mobile-menu-btn');
    const mobileNav = document.querySelector('#mobile-nav');
    if (mobileMenuBtn && mobileNav) {
      mobileMenuBtn.addEventListener('click', () => {
        const isOpen = mobileNav.style.maxHeight !== '0px' && mobileNav.style.maxHeight !== '';
        mobileNav.style.maxHeight = isOpen ? '0px' : '300px';
      });
    }

    // 监听系统主题偏好变化
    if (window.matchMedia) {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('agentforge-theme')) {
          themeManager.set(e.matches ? 'dark' : 'light');
          updateThemeIcons(themeManager.get());
        }
      });
    }
  }

  function updateThemeIcons(theme) {
    const sunIcon = document.querySelector('#theme-icon-sun');
    const moonIcon = document.querySelector('#theme-icon-moon');
    if (sunIcon && moonIcon) {
      sunIcon.style.display = theme === 'dark' ? 'block' : 'none';
      moonIcon.style.display = theme === 'light' ? 'block' : 'none';
    }
  }

  // ── 路由处理 ──
  function handleRoute() {
    const hash = window.location.hash || '#/';
    const normalizedHash = hash.split('?')[0]; // 忽略查询参数

    // 如果精确匹配
    if (ROUTES[normalizedHash]) {
      loadPage(normalizedHash);
      return;
    }

    // 模糊匹配（处理子路由）
    const matchedRoute = Object.keys(ROUTES).find(route => {
      if (route === '#/') return false;
      return normalizedHash === route || normalizedHash.startsWith(route + '/');
    });

    if (matchedRoute) {
      loadPage(matchedRoute);
      return;
    }

    // 404 - 重定向到首页
    loadPage('#/');
  }

  // ── 加载页面 ──
  async function loadPage(hash) {
    if (hash === currentRoute) return;
    currentRoute = hash;

    const url = ROUTES[hash];
    if (!url) {
      window.location.hash = '#/';
      return;
    }

    const main = document.querySelector('main');
    if (!main) return;

    // 页面过渡
    main.style.opacity = '0';
    main.style.transform = 'translateY(8px)';
    main.style.transition = 'opacity 0.2s ease, transform 0.2s ease';

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      let html = await response.text();

      // 注入页面内容
      main.innerHTML = html;

      // 设置导航状态
      const navKey = ROUTE_NAV_KEYS[hash] || '';
      if (navKey) {
        window.__ACTIVE_NAV_KEY__ = navKey;
        updateActiveNav(navKey);
      }

      // 页面初始化回调
      const pageInitScript = html.match(/<script>([\s\S]*?pageInit[\s\S]*?)<\/script>/);
      // 页面特定初始化
      setTimeout(() => {
        initPageScripts(hash);
        // 触发入场动画
        main.style.opacity = '1';
        main.style.transform = 'translateY(0)';
      }, 50);

    } catch (err) {
      console.error('Failed to load page:', url, err);
      main.innerHTML = `
        <div style="text-align:center; padding:80px 20px;">
          <h2 style="font-family:var(--font-serif); font-size:24px; color:var(--foreground);">页面加载失败</h2>
          <p style="color:var(--muted-foreground); margin-top:8px;">请检查网络连接后重试</p>
          <button class="btn btn-primary" style="margin-top:20px;" onclick="location.reload()">刷新页面</button>
        </div>
      `;
      main.style.opacity = '1';
      main.style.transform = 'translateY(0)';
    }
  }

  // ── 更新导航高亮 ──
  function updateActiveNav(navKey) {
    document.querySelectorAll('[data-nav-key]').forEach(item => {
      item.removeAttribute('data-active');
      item.removeAttribute('aria-current');
      if (item.dataset.navKey === navKey) {
        item.setAttribute('data-active', 'true');
        item.setAttribute('aria-current', 'page');
      }
    });
  }

  // ── 页面特定脚本初始化 ──
  function initPageScripts(hash) {
    // 重新初始化图标（预留，当前使用内联SVG）
    // 图标使用内联SVG，无需额外库

    // 滚动入场动画
    initScrollAnimations();

    // 文章页TOC初始化
    if (hash.startsWith('#/knowledge') || hash.startsWith('#/llm')) {
      setTimeout(() => {
        if (window.TocManager) {
          const toc = new TocManager();
          toc.init();
        }
      }, 100);
    }

    // 动画页面初始化
    if (hash === '#/knowledge/react') initReactAnimation();
    if (hash === '#/knowledge/cot') initCotAnimation();
    if (hash === '#/knowledge/got') initGotAnimation();
    if (hash === '#/knowledge/tot') initTotAnimation();
    if (hash === '#/knowledge/mcp') initMcpAnimation();
    if (hash === '#/knowledge/context') initLoopAnimation();

    // 登录/注册页面
    if (hash === '#/login' || hash === '#/register') {
      initAuthPage();
    }

    // 设置页
    if (hash === '#/settings') {
      initSettingsPage();
    }

    // 主页
    if (hash === '#/') {
      initHomePage();
    }
  }

  // ── 滚动入场动画 ──
  function initScrollAnimations() {
    const animated = document.querySelectorAll('.animate-on-scroll');
    if (!animated.length) return;

    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

      animated.forEach(el => observer.observe(el));
    } else {
      animated.forEach(el => el.classList.add('visible'));
    }
  }

  // ── 各动画页面初始化 ──
  function initReactAnimation() {
    const container = document.querySelector('#react-animation');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    const anim = new ReactAnimation(container);
    const player = anim.player;
    new AnimationControls(player);
  }

  function initCotAnimation() {
    const container = document.querySelector('#cot-animation');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    const anim = new CotAnimation(container);
    const player = anim.player;
    new AnimationControls(player);
  }

  function initTotAnimation() {
    const container = document.querySelector('#tot-animation');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    const anim = new TotAnimation(container);
    const player = anim.player;
    new AnimationControls(player);
  }

  function initGotAnimation() {
    const container = document.querySelector('#got-animation');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    const anim = new GotAnimation(container);
    const player = anim.player;
    new AnimationControls(player);
  }

  function initMcpAnimation() {
    const container = document.querySelector('#mcp-animation');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    const anim = new McpAnimation(container);
    const player = anim.player;
    new AnimationControls(player);
  }

  function initLoopAnimation() {
    const container = document.querySelector('#loop-animation');
    if (!container || container.dataset.initialized) return;
    container.dataset.initialized = 'true';

    const anim = new LoopAnimation(container);
    const player = anim.player;
    new AnimationControls(player);
  }

  // ── 认证页面 ──
  function initAuthPage() {
    const form = document.querySelector('.auth-form');
    if (!form || form.dataset.initialized) return;
    form.dataset.initialized = 'true';

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = '处理中...';

      // 模拟提交（Phase 2接入真实API）
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = originalText;
        alert('认证功能将在Phase 2后端开发完成后接入。\n\n当前为前端演示模式。');
      }, 1000);
    });
  }

  // ── 设置页 ──
  function initSettingsPage() {
    const themeToggle = document.querySelector('#setting-theme-toggle');
    if (themeToggle && !themeToggle.dataset.initialized) {
      themeToggle.dataset.initialized = 'true';
      themeToggle.addEventListener('click', () => {
        themeManager.toggle();
        updateThemeIcons(themeManager.get());
        themeToggle.textContent = themeManager.get() === 'dark' ? '当前：深色模式' : '当前：浅色模式';
      });
      themeToggle.textContent = themeManager.get() === 'dark' ? '当前：深色模式' : '当前：浅色模式';
    }
  }

  // ── 主页 ──
  function initHomePage() {
    // 数字count-up动画
    const counters = document.querySelectorAll('.stat-number[data-count-to]');
    if (!counters.length) return;

    const reduceMotion = window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;

    if (reduceMotion) {
      counters.forEach(el => {
        el.textContent = el.getAttribute('data-count-to') || '0';
      });
      return;
    }

    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        const target = parseInt(el.getAttribute('data-count-to'), 10) || 0;
        const duration = 1200;
        const startTs = performance.now();

        function step(ts) {
          const progress = Math.min((ts - startTs) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          el.textContent = Math.round(target * eased).toString();
          if (progress < 1) requestAnimationFrame(step);
          else el.textContent = target.toString();
        }
        requestAnimationFrame(step);
        counterObserver.unobserve(el);
      });
    }, { threshold: 0.5 });

    counters.forEach(el => counterObserver.observe(el));

    // Hero图片视差
    const parallax = document.querySelector('.hero-parallax');
    if (parallax && !reduceMotion) {
      const maxTilt = 5;
      parallax.addEventListener('mousemove', (e) => {
        const rect = parallax.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        parallax.style.transform = `perspective(1000px) rotateX(${(-y * maxTilt).toFixed(2)}deg) rotateY(${(x * maxTilt).toFixed(2)}deg)`;
      });
      parallax.addEventListener('mouseleave', () => {
        parallax.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg)';
        parallax.style.transition = 'transform 0.5s ease';
        setTimeout(() => { parallax.style.transition = ''; }, 500);
      });
    }
  }

  // ── Agent浮动按钮 ──
  function initAgentFloat() {
    if (document.querySelector('.agent-float')) return;

    const float = document.createElement('div');
    float.className = 'agent-float';
    float.innerHTML = `
      <button class="agent-float-btn" id="agent-float-toggle" aria-label="Agent助手">
        <span class="agent-float-dot"></span>
        <span>Agent 助手</span>
      </button>
      <div class="agent-panel" id="agent-panel">
        <div class="agent-panel-header">
          <span class="agent-panel-title" style="font-family:var(--font-mono); font-weight:700; letter-spacing:0.05em;">AGENT</span>
          <button class="agent-panel-close" id="agent-panel-close" aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="agent-panel-body" id="agent-panel-body">
          <div style="text-align:center; padding:40px 20px; color:var(--muted-foreground);">
            <div style="font:700 11px/1 var(--font-mono); letter-spacing:0.1em; text-transform:uppercase; color:var(--muted-foreground); margin-bottom:12px;">AGENT ASSISTANT</div>
            <p style="font-size:14px; font-weight:500; color:var(--foreground); margin-bottom:8px;">对话功能即将推出</p>
            <p style="font-size:12px; line-height:1.6;">Phase 3 上线后你将可以使用：\n- 点击不懂的内容直接提问\n- Agent 记住你的学习进度\n- 悬停获取快速概念解释</p>
          </div>
        </div>
        <div class="agent-panel-input">
          <input type="text" class="input" placeholder="输入你的问题..." disabled style="flex:1;">
          <button class="btn btn-primary" disabled style="min-height:42px;">发送</button>
        </div>
      </div>
    `;

    document.body.appendChild(float);

    // 事件绑定
    const toggle = float.querySelector('#agent-float-toggle');
    const panel = float.querySelector('#agent-panel');
    const close = float.querySelector('#agent-panel-close');

    toggle.addEventListener('click', () => {
      panel.classList.toggle('open');
    });

    close.addEventListener('click', () => {
      panel.classList.remove('open');
    });

    // 点击外部关闭
    document.addEventListener('click', (e) => {
      if (!float.contains(e.target)) {
        panel.classList.remove('open');
      }
    });
  }

  // ── 启动 ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
