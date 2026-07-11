/* ═══════════════════════════════════════════════════════════════
   theme-manager.js — AgentForge 主题管理
   ═══════════════════════════════════════════════════════════════ */

class ThemeManager {
  constructor() {
    this.STORAGE_KEY = 'agentforge-theme';
    this.currentTheme = this._load();
    this._apply(this.currentTheme);
  }

  /** 返回当前主题: 'light' | 'dark' */
  get() {
    return this.currentTheme;
  }

  /** 切换主题 */
  toggle() {
    this.currentTheme = this.currentTheme === 'light' ? 'dark' : 'light';
    this._apply(this.currentTheme);
    this._save(this.currentTheme);
  }

  /** 设置指定主题 */
  set(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    this.currentTheme = theme;
    this._apply(this.currentTheme);
    this._save(this.currentTheme);
  }

  /** 订阅主题变化 */
  onThemeChange(callback) {
    this._listeners = this._listeners || [];
    this._listeners.push(callback);
  }

  _apply(theme) {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);

    // 更新所有 theme-toggle 按钮的图标
    document.querySelectorAll('[data-theme-toggle]').forEach(btn => {
      btn.setAttribute('aria-label', theme === 'dark' ? '切换浅色模式' : '切换深色模式');
    });
  }

  _save(theme) {
    try { localStorage.setItem(this.STORAGE_KEY, theme); } catch (e) {}
    (this._listeners || []).forEach(cb => cb(theme));
  }

  _load() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') return stored;
    } catch (e) {}
    // 检查系统偏好
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  }
}

window.ThemeManager = ThemeManager;
