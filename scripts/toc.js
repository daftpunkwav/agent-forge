/* ═══════════════════════════════════════════════════════════════
   toc.js — AgentForge 文章目录（TOC）系统
   - 从文章内容自动提取h2/h3生成目录
   - IntersectionObserver追踪当前阅读位置
   - 移动端折叠为抽屉
   ═══════════════════════════════════════════════════════════════ */

class TocManager {
  constructor(options = {}) {
    this.articleSelector = options.articleSelector || '.article-content';
    this.tocContainerSelector = options.tocContainerSelector || '.toc';
    this.activeClass = options.activeClass || 'active';
    this.observerThreshold = options.threshold || 0.3;
    this.observerRootMargin = options.rootMargin || '-80px 0px -60% 0px';
    this._observer = null;
    this._headingElements = [];
  }

  /** 初始化TOC，应在文章内容渲染后调用 */
  init() {
    const article = document.querySelector(this.articleSelector);
    const tocContainer = document.querySelector(this.tocContainerSelector);
    if (!article || !tocContainer) return;

    // 提取所有h2/h3
    const headings = article.querySelectorAll('h2, h3');
    if (headings.length === 0) {
      tocContainer.innerHTML = '<p style="font-size:12px; color:var(--muted-foreground);">此文章无目录</p>';
      return;
    }

    // 确保每个heading有id
    headings.forEach((h, i) => {
      if (!h.id) {
        h.id = 'section-' + i + '-' + h.textContent.trim().toLowerCase().replace(/[^\w一-龥]+/g, '-').substring(0, 40);
      }
    });

    this._headingElements = headings;

    // 生成TOC HTML
    const tocList = document.createElement('ul');
    tocList.className = 'toc-list';

    headings.forEach(h => {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = '#' + h.id;
      link.textContent = h.textContent.trim();
      link.className = 'toc-item' + (h.tagName === 'H3' ? ' toc-item-h3' : '');
      link.dataset.targetId = h.id;

      link.addEventListener('click', (e) => {
        e.preventDefault();
        const target = document.getElementById(h.id);
        if (target) {
          const offset = 80;
          const top = target.getBoundingClientRect().top + window.pageYOffset - offset;
          window.scrollTo({ top, behavior: 'smooth' });
        }
      });

      item.appendChild(link);
      tocList.appendChild(item);
    });

    // 清空并填充TOC容器
    const existingTitle = tocContainer.querySelector('.toc-title');
    tocContainer.innerHTML = '';
    if (existingTitle) tocContainer.appendChild(existingTitle);
    tocContainer.appendChild(tocList);

    // 移动端TOC抽屉切换
    this._setupMobileToc(tocContainer);

    // 设置滚动监听
    this._setupScrollSpy(tocContainer);
  }

  _setupMobileToc(tocContainer) {
    // Toggle button for mobile
    if (!document.querySelector('.toc-toggle')) {
      const toggle = document.createElement('button');
      toggle.className = 'toc-toggle';
      toggle.innerHTML = '<span style="font-size:14px;">📋</span>';
      toggle.setAttribute('aria-label', '目录');
      toggle.style.cssText = `
        display: none;
        position: fixed;
        bottom: 24px;
        left: 24px;
        z-index: 150;
        width: 44px;
        height: 44px;
        border: 1px solid var(--border);
        border-radius: 50%;
        background: var(--card);
        color: var(--foreground);
        font-size: 18px;
        box-shadow: var(--shadow-lg);
        cursor: pointer;
        align-items: center;
        justify-content: center;
      `;
      document.body.appendChild(toggle);

      toggle.addEventListener('click', () => {
        tocContainer.classList.toggle('open');
      });

      // Show on mobile
      if (window.innerWidth <= 768) {
        toggle.style.display = 'flex';
      }
      window.addEventListener('resize', () => {
        toggle.style.display = window.innerWidth <= 768 ? 'flex' : 'none';
      });
    }
  }

  _setupScrollSpy(tocContainer) {
    const tocLinks = tocContainer.querySelectorAll('.toc-item');

    // 清除旧observer
    if (this._observer) this._observer.disconnect();

    this._observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocLinks.forEach(link => {
            link.classList.remove(this.activeClass);
            if (link.dataset.targetId === id) {
              link.classList.add(this.activeClass);
            }
          });
        }
      });
    }, {
      threshold: this.observerThreshold,
      rootMargin: this.observerRootMargin
    });

    this._headingElements.forEach(h => this._observer.observe(h));
  }

  destroy() {
    if (this._observer) this._observer.disconnect();
    const toggle = document.querySelector('.toc-toggle');
    if (toggle) toggle.remove();
  }
}

window.TocManager = TocManager;
