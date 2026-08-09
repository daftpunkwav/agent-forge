import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  /** 渲染失败时的降级 UI；传 null 表示静默隐藏（如 Agent 挂件） */
  fallback?: ReactNode;
  /** 边界名，进 console 日志便于定位（R-09） */
  name?: string;
};

type State = { hasError: boolean };

/**
 * R-09：错误边界——把渲染期崩溃隔离在子树内，避免整站白屏。
 * React 19 函数组件无法捕获渲染错误，必须是 class 组件。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 只进 console，不上报（项目无遥测）；name 帮助定位是哪一层边界
    console.error(`[ErrorBoundary:${this.props.name || 'anonymous'}]`, error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback;
      return (
        <div className="container" style={{ padding: 64 }}>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 24, margin: '0 0 12px' }}>
            页面出现异常
          </h1>
          <p style={{ color: 'var(--muted-foreground)', margin: '0 0 16px' }}>
            该模块暂时不可用，其余功能不受影响。
          </p>
          <a href="/" className="btn btn-primary btn-sm" style={{ textDecoration: 'none' }}>
            返回首页
          </a>
        </div>
      );
    }
    return this.props.children;
  }
}
