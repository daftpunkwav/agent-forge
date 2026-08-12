# 架构脱耦与韧性审查报告（故障隔离 / 熔断 / 降级 / 高并发）

> 审查日期：2026-08-09
> 审查范围：服务间脱耦（运行时 + 启动时）、业务域脱耦、故障隔离、熔断/降级、高并发韧性、可维护性与可扩展性
> 审查性质：**只读审查 + 改造方案，未修改任何代码**
> 证据基准：仓库代码（commit `09ca558`，分支 master）逐文件核验 + codebase-memory 图谱（1485 节点 / 3264 边）+ openwiki 索引
> 前置报告：`docs/reviews/architecture-review-2026-08-04.md`（结构/安全/文档一致性）；本报告聚焦**故障隔离与韧性**，与其互补不重复
> 读者假设：**报告写给执行改造的工程师（或 AI）**：每一项都给出「为什么改 / 改哪里 / 完整可粘贴代码 / 怎么验证」，不需要再读源码即可施工

---

## 0. 一页结论

### 0.1 总体评价

AgentForge 的**静态边界是干净的**：`apps/web` 与 `apps/api` 之间零交叉 import（图谱 Cypher 核验 0 条跨向 CALLS/IMPORTS 边），共享逻辑收敛在 `packages/shared` 单一真相。安全与错误处理纪律好（A-01 错误脱敏、A-02 统一 30s 超时、B-05 单次重试、I5 先持久化再 final，均有测试）。

但**运行时故障隔离没有达到「Agent 坏了不影响其他页面/功能」的要求**，启动期也缺少「关键依赖 fail-fast、可选依赖降级启动」的区分。核心差距：

| # | 差距 | 现状后果 | 修复 |
|---|------|----------|------|
| 1 | 前端**没有任何 ErrorBoundary**，`AgentFloat`（914 行）全局挂载 | Agent 组件渲染期抛错 → React 19 卸载整棵树 → **全站白屏** | P0-1 |
| 2 | 前端**无代码分割**，20 个页面静态打进一个 542KB chunk | 任一页面模块级错误 → 整个 chunk 加载失败 → **全站不可用** | P0-2 |
| 3 | LLM 调用**无熔断器** | 上游宕机时每个请求挂 30~60s 才失败，高并发下连接/内存堆积，拖垮同进程所有域 | P0-3 |
| 4 | LLM 调用**无全局并发上限（舱壁）** | 限流是 per-IP，N 个 IP 可打满上游与 DB 连接池 | P0-4 |
| 5 | **无优雅关闭**，无就绪探针 | 发布硬切 SSE 长连接；LB 无法区分「活着」与「可服务」；`/health` 还在限流器之后，可被限流拖死 | P0-5 |
| 6 | 悬停缓存**顺序颠倒 + 读未隔离** | 撤掉 LLM env 后连缓存命中的悬停也全灭；缓存表故障 → `/explain` 直接 500 | P0-6 |
| 7 | **无 Provider 故障转移** | 配置了多个 Provider，主 Provider 挂了照样全灭 | P1-1 |
| 8 | tool-loop **无整体时限** | 最坏 5×(30s+8s)≈190s，前端 90s 已超时，服务端空跑烧配额 | P1-2 |
| 9 | SSE **无心跳** | 反代（Nginx 默认 60s）可切断长流，deep 模式首 token 慢时掉线 | P1-3 |
| 10 | **无启动期 env 校验** | `JWT_SECRET` 缺失时不在启动时 fail-fast，而是运行时所有受保护路由 500 | P1-4 |
| 11 | Agent 限流**单桶**且悬停扫射可耗尽对话配额 | 悬停高频预取（前端 8 次/10s）与对话共用 40/min 桶 | P1-5 |

### 0.2 已经做对、不要动的东西

以下设计**已经符合企业级要求**，改造时不要破坏：

- **web↔api 零交叉依赖**；`packages/shared`（DTO / 权限矩阵 / hoverSanitize）为前后端单一真相。
- **A-02**：`callLlm`/`streamLlm` 统一 30s 超时（`apps/api/src/lib/llm/providerHttp.ts:37` `withTimeout`）。
- **B-05**：仅 5xx/网络错误重试一次，4xx/超时/主动取消不重试（`providerHttp.ts:17` `isRetriable`）。
- **A-01**：上游错误诊断字段只进日志，客户端只见安全文案（`agentOrchestrator.ts:201` `llmError`）。
- **I2/I3/I5**：客户端断开传播取消上游、流式 per-delta 门控、先持久化再 final。
- **前端降级已有底子**：`api.ts:35` 15s 请求超时 + refresh 单飞；`agentStream.ts:44` SSE 独立 28s 超时；`useAgentPanel.ts` 流式失败自动 fallback 同步接口；`useAuth.tsx:47` 仅 401/403 清登录态，5xx/断网保留；`AgentFloat.tsx:88-107` 悬停全局串行 + 280ms 冷却 + 8 次/10s 窗口防扫射。
- **分级限流骨架**：`generalLimiter`/`authLimiter`/`agentLimiter`/`testLlmLimiter` 已按域分开（`app.ts:55-77`、`settings.ts:28-33`）。
- **B-07**：过期匿名会话节流清理（`agentConversation.ts:22-35`）——本报告 P2-2 复用同款模式。

### 0.3 改造清单总览

| 优先级 | 编号 | 主题 | 改动文件 | 破坏兼容？ | 工作量 |
|--------|------|------|----------|-----------|--------|
| **P0**（故障隔离基线） | P0-1 | 前端三层 ErrorBoundary | 新建 1 + 改 2 | 否（视觉用现有 CSS 变量） | 0.5d |
| | P0-2 | 路由级代码分割 | 改 `router.tsx` 1 个文件 | 否 | 0.5d |
| | P0-3 | LLM 熔断器 | 新建 1 + 改 1 | 否 | 1d |
| | P0-4 | LLM 全局并发舱壁 | 同上（同文件） | 否（新增 env） | 含上 |
| | P0-5 | 优雅关闭 + 健康/就绪分离 | 改 2 | 否 | 0.5d |
| | P0-6 | 悬停缓存顺序修正 + 缓存读隔离 | 改 2 | 否（行为更宽容） | 0.5d |
| **P1**（降级与韧性） | P1-1 | Provider 故障转移链 | 改 3 | 否（默认行为增强） | 1d |
| | P1-2 | tool-loop 整体 deadline | 改 2 | 否 | 0.5d |
| | P1-3 | SSE 心跳 | 改 2 | 否 | 0.5d |
| | P1-4 | 启动期 env 校验 | 新建 1 + 改 1 | **生产弱配置会拒绝启动**（有意为之） | 0.5d |
| | P1-5 | Agent 限流分桶 | 改 1 | 否（阈值更合理） | 0.5d |
| **P2**（规模化） | P2-1 | hover 用户上下文缓存 | 改 2 | 否 | 0.5d |
| | P2-2 | hoverCache 表定期清理 | 改 1 | 否 | 0.5d |
| | P2-3 | 前端 Agent 熔断降级 | 改 2 | 否 | 0.5d |
| | P2-4 | 多实例部署说明 + Redis 预留 | 仅文档/env | 否 | 0.5d |
| | P2-5 | docker-compose 完整化 + 死目录清理 | 改 1 + 删 1 | 否 | 0.5d |

**不需要任何 DB schema 变更、不需要 migration、不改变 SSE/REST 契约、不改变前端视觉。** 全部改造向后兼容。

新标记约定：沿用仓库 A-/B-/C-/D-/I- 注释传统，本报告引入 **R-xx（Resilience 韧性）系列**：R-01 熔断、R-02 舱壁、R-03 优雅关闭、R-04 故障转移、R-05 心跳、R-06 缓存隔离、R-07 启动校验、R-08 整体时限、R-09 前端边界、R-10 限流分桶。施工时把标记写进代码注释，便于后续审查索引。

---

## 1. 现状架构与故障传导分析

### 1.1 运行时拓扑（核验后）

```
浏览器 SPA (apps/web, :5280)
  │  单 chunk 542KB，无 ErrorBoundary
  │  AppShell 全局挂载 AgentFloat（悬停+面板双 Agent）
  ▼
Express 5 单进程 (apps/api, :3001)
  ├─ /api/v1/auth · articles · animations · author-applications
  │    domains · settings · topics · annotations   ← 8 个业务域
  ├─ /api/v1/agent（agentLimiter 40/min/IP）
  │    ├─ /explain(/stream)  悬停/选中讲解 ──► loadUserContext(3条DB查询+BYOK解密)
  │    │                                        ├─► hoverCache L2（Prisma 表）
  │    │                                        └─► callLlm/streamLlm ──► 上游 LLM
  │    ├─ /chat(/stream)     面板对话 ──► prepareChat ──► callLlm 或 runToolLoop(≤5轮)
  │    └─ /memory · /progress · /cache/clear · /providers · /meta
  ├─ /health（在 generalLimiter 之后！）
  └─ PrismaClient 单例 ──► SQLite dev.db（生产可切 PostgreSQL）
```

### 1.2 故障场景推演（「Agent 坏了」到底会怎样）

| 场景 | 当前实际后果 | 根因 |
|------|-------------|------|
| LLM 上游宕机/挂起 | 每个 Agent 请求挂 30~60s 后 502；并发高时连接堆积，**同进程的文章/话题/登录响应变慢**；缓存命中的悬停不受影响（缓解项） | 无熔断、无舱壁 |
| 撤销 LLM env（重启后无 Provider） | **连缓存命中的悬停讲解也全部 NO_PROVIDER 失败** | `/explain` 先 `runExplain`（内含 `resolveProvider` 抛错）后查缓存，顺序颠倒（`agent.ts:92-95`） |
| hoverCache 表损坏/DB 抖动 | `/explain` 直接 500，即使 LLM 路径本可成功 | `getHoverCache` 异常未被隔离（`agent.ts:95` 裸 await） |
| AgentFloat 渲染期抛错（如净化正则异常） | **全站白屏**，所有页面不可用 | 无 ErrorBoundary（全仓 grep 0 命中） |
| 任一页面模块级抛错 | 整个 542KB chunk 加载失败，**全站不可用** | 无代码分割（`router.tsx:3-19` 全静态 import） |
| 容器滚动发布 | in-flight SSE 被硬切；SQLite 写可能截断 | `index.ts` 无 SIGTERM 处理（全文 10 行） |
| LB 健康检查 1s/次 | 计入 120/min 限流预算，**健康检查自己被 429 → LB 摘流 → 假性宕机** | `/health` 在 `generalLimiter` 之后挂载（`app.ts:67-71`） |
| tool-loop 复杂问题 | 服务端最长空跑 ~190s，前端 90s 已断开 | `runToolLoop` 无整体 deadline（`toolLoop.ts:69`） |
| 多副本部署 | per-IP 限流按实例各自计数，实际全局限流 ÷N | express-rate-limit MemoryStore（已文档化为可接受，需 Redis 接口） |

### 1.3 启动期耦合分析

现状启动链路：`index.ts` → `createApp()`（同步装配全部路由）→ `app.listen()`。

**做对的部分**：`loadProviders()` 惰性加载（`providers.ts:36`，首次调用才读 env）；`byokCrypto.key()` 调用时才读 env（`byokCrypto.ts:14-20`）；Prisma 首次查询才连库。**LLM 未配置不会阻止进程启动**——这符合「启动脱耦」，要保留。

**缺失的部分**：

1. **关键依赖不 fail-fast**：`JWT_SECRET` 缺失/过短时，`jwt.ts:13-19` `secret()` 在第一次签名/验签才抛错 → 启动看似成功，运行时所有受保护路由 500。正确做法：启动时校验关键 env，缺失则**拒绝启动并打印明确原因**；而 LLM 这类可选依赖只 **warn 降级**，不影响启动。
2. **无优雅关闭**：见 P0-5。
3. **无就绪探针**：见 P0-5。

---

## 2. P0 改造：故障隔离基线

---

### P0-1 前端三层 ErrorBoundary（R-09）

#### 为什么改

全仓 grep 确认 **0 个 ErrorBoundary**（无 `componentDidCatch`/`getDerivedStateFromError`）。React 19 中任何未被捕获的渲染期错误会卸载整棵组件树 → 白屏。`AgentFloat`（914 行，挂全局 mouseover 监听、定时器、SSE）在 `AppShell.tsx:357` 全局挂载——**它是全站单点**。这正是「agent 坏了，影响所有页面」的直接证据。

#### 设计：三层防线

| 层 | 位置 | 捕获范围 | 降级表现 |
|----|------|----------|----------|
| L1 根边界 | `main.tsx` 包 `RouterProvider` | AppShell/路由级崩溃 |  branded 错误页（用现有 CSS 变量，不改视觉体系），提供「刷新/回首页」 |
| L2 页面边界 | `AppShell.tsx` 包 `<Outlet/>`，`key=pathname` | 单页面崩溃 | 页头页脚保留，内容区显示错误 + 返回首页 |
| L3 Agent 静默边界 | `AppShell.tsx` 包 `<AgentFloat/>`，`fallback={null}` | 双 Agent 崩溃 | **Agent 静默消失，其余一切不受影响**——直接兑现「agent 坏了不影响其他页面」 |

#### 改动 1：新建 `apps/web/src/components/layout/ErrorBoundary.tsx`

```tsx
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
```

#### 改动 2：`apps/web/src/main.tsx`（L1 根边界）

现状（`main.tsx:9-17`）：

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

改为：

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <AuthProvider>
        {/* R-09 L1：根边界——AppShell/路由级崩溃时保住 branded 错误页 */}
        <ErrorBoundary name="root">
          <RouterProvider router={router} />
        </ErrorBoundary>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
);
```

并在文件顶部 import 区加：

```tsx
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
```

#### 改动 3：`apps/web/src/components/layout/AppShell.tsx`（L2 + L3）

顶部 import 区加：

```tsx
import { useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
```

`AppShell()` 函数体内、现有 hooks 之后加：

```tsx
const location = useLocation();
```

现状（`AppShell.tsx:261-263`）：

```tsx
      <main style={{ flex: 1, minHeight: '60vh' }}>
        <Outlet />
      </main>
```

改为（`key` 让路由切换时自动重置边界，错误页不会粘在下一页）：

```tsx
      <main style={{ flex: 1, minHeight: '60vh' }}>
        {/* R-09 L2：页面边界——单页面崩溃不带走页头页脚与其他页面 */}
        <ErrorBoundary key={location.pathname} name="page">
          <Outlet />
        </ErrorBoundary>
      </main>
```

现状（`AppShell.tsx:357`）：

```tsx
      <AgentFloat />
```

改为：

```tsx
      {/* R-09 L3：Agent 静默边界——双 Agent 崩溃时静默隐藏，不影响任何页面 */}
      <ErrorBoundary name="agent" fallback={null}>
        <AgentFloat />
      </ErrorBoundary>
```

#### 验证

1. `npm run build` 通过。
2. 临时在 `AgentFloat` 函数体第一行加 `if (location.pathname === '/') throw new Error('test')`：首页正常显示（页头页脚在），仅右下角 Agent 消失 → 撤销临时代码。
3. 临时在 `ArticlePage` 顶部 throw：文章页内容区显示降级 UI，页头导航仍可点击跳转 → 撤销。
4. `npm run dev:web` 打开各路由确认无回归。

---

### P0-2 路由级代码分割

#### 为什么改

`apps/web/dist/assets/index-*.js` 实测 **542KB 单 chunk**：`router.tsx:3-19` 静态 import 全部 20 个页面（含 Markdown 编辑器、动画编辑器、admin 页）+ `AgentFloat` 914 行 + marked/dompurify。后果有二：

1. **故障耦合**：任一页面模块级错误 → 整个 chunk 加载失败 → 全站不可用。
2. **性能**：读者首屏被迫下载作者/管理端代码。

代码分割后每个懒加载页面是独立 chunk：单页面 chunk 加载/执行失败只会触发 L2 页面边界降级（P0-1），**不再波及其他页面**。

#### 改动：整体替换 `apps/web/src/app/router.tsx`

> 注意：本项目页面均为**具名导出**，`React.lazy` 需要 default 导出，因此用 `.then((m) => ({ default: m.X }))` 映射。首页 `HomePage` 保持静态 import（首屏 LCP 不付懒加载往返）。

```tsx
import { Suspense, lazy } from 'react';
import { createBrowserRouter, Link } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';

/**
 * 路由级代码分割（R-09 配套）：
 * - 每个懒页面独立 chunk——单页面模块错误只触发页面边界降级，不再拖垮整站；
 * - 首页保持 eager（首屏 LCP）；作者/管理端重组件按需加载。
 */
const KnowledgeOverviewPage = lazy(() =>
  import('@/pages/KnowledgeOverviewPage').then((m) => ({ default: m.KnowledgeOverviewPage })),
);
const ArticlePage = lazy(() =>
  import('@/pages/ArticlePage').then((m) => ({ default: m.ArticlePage })),
);
const LlmOverviewPage = lazy(() =>
  import('@/pages/LlmOverviewPage').then((m) => ({ default: m.LlmOverviewPage })),
);
const LoginPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/pages/AuthPages').then((m) => ({ default: m.RegisterPage })),
);
const ProfilePage = lazy(() =>
  import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const NewsPage = lazy(() => import('@/pages/NewsPage').then((m) => ({ default: m.NewsPage })));
const DomainDetailPage = lazy(() =>
  import('@/pages/DomainDetailPage').then((m) => ({ default: m.DomainDetailPage })),
);
const SearchPage = lazy(() =>
  import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })),
);
const DomainsAdminPage = lazy(() =>
  import('@/pages/admin/DomainsAdminPage').then((m) => ({ default: m.DomainsAdminPage })),
);
const AuthorDashboard = lazy(() =>
  import('@/pages/author/AuthorDashboard').then((m) => ({ default: m.AuthorDashboard })),
);
const ArticleEditorPage = lazy(() =>
  import('@/pages/author/ArticleEditorPage').then((m) => ({ default: m.ArticleEditorPage })),
);
const AnimationEditorPage = lazy(() =>
  import('@/pages/author/AnimationEditorPage').then((m) => ({ default: m.AnimationEditorPage })),
);
const ApplyAuthorPage = lazy(() =>
  import('@/pages/author/ApplyAuthorPage').then((m) => ({ default: m.ApplyAuthorPage })),
);
const ApplicationsAdminPage = lazy(() =>
  import('@/pages/author/ApplicationsAdminPage').then((m) => ({ default: m.ApplicationsAdminPage })),
);
const TopicsPage = lazy(() => import('@/pages/TopicsPage').then((m) => ({ default: m.TopicsPage })));
const TopicNewPage = lazy(() =>
  import('@/pages/TopicsPage').then((m) => ({ default: m.TopicNewPage })),
);
const TopicDetailPage = lazy(() =>
  import('@/pages/TopicsPage').then((m) => ({ default: m.TopicDetailPage })),
);

/** 懒页面加载中占位：复用现有样式变量，不改视觉体系 */
function PageLoading() {
  return (
    <div className="container" style={{ padding: 64, color: 'var(--muted-foreground)' }}>
      加载中…
    </div>
  );
}

/** 统一包一层 Suspense；渲染期错误由 AppShell 的 L2 页面边界（R-09）兜底 */
function S({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'knowledge', element: <S><KnowledgeOverviewPage /></S> },
      { path: 'knowledge/:slug', element: <S><ArticlePage /></S> },
      { path: 'llm', element: <S><LlmOverviewPage /></S> },
      { path: 'llm/:slug', element: <S><ArticlePage /></S> },
      { path: 'domains/:slug', element: <S><DomainDetailPage /></S> },
      { path: 'search', element: <S><SearchPage /></S> },
      { path: 'news', element: <S><NewsPage /></S> },
      { path: 'topics', element: <S><TopicsPage /></S> },
      { path: 'topics/new', element: <S><TopicNewPage /></S> },
      { path: 'topics/:id', element: <S><TopicDetailPage /></S> },
      { path: 'login', element: <S><LoginPage /></S> },
      { path: 'register', element: <S><RegisterPage /></S> },
      { path: 'profile', element: <S><ProfilePage /></S> },
      { path: 'settings', element: <S><SettingsPage /></S> },
      { path: 'admin/domains', element: <S><DomainsAdminPage /></S> },
      { path: 'author', element: <S><AuthorDashboard /></S> },
      { path: 'author/articles/new', element: <S><ArticleEditorPage /></S> },
      { path: 'author/articles/:id/edit', element: <S><ArticleEditorPage /></S> },
      { path: 'author/animations/new', element: <S><AnimationEditorPage /></S> },
      { path: 'author/animations/:id/edit', element: <S><AnimationEditorPage /></S> },
      { path: 'author/apply', element: <S><ApplyAuthorPage /></S> },
      { path: 'author/applications', element: <S><ApplicationsAdminPage /></S> },
      {
        path: '*',
        // 404 兜底：未匹配路由也渲染在 AppShell 内；内联 JSX 避免本文件混入组件定义（fast refresh 限制）
        element: (
          <div className="container" style={{ padding: 64 }}>
            <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 28, margin: '0 0 12px' }}>页面不存在</h1>
            <p style={{ color: 'var(--muted-foreground)', margin: 0 }}>
              你访问的地址没有匹配的页面。<Link to="/">返回首页</Link>
            </p>
          </div>
        ),
      },
    ],
  },
]);
```

#### 验证

1. `npm run build:web` 后 `ls apps/web/dist/assets/`：应出现多个按页面命名的 chunk，主 chunk 显著缩小（预期 <250KB）。
2. `npm run dev:web` 逐路由访问，确认无白屏、无 `React.lazy` 警告。
3. DevTools Network 面板：进入 `/author/articles/new` 时才下载编辑器 chunk。

---

### P0-3 + P0-4 LLM 熔断器与全局并发舱壁（R-01 / R-02）

#### 为什么改

**熔断（Circuit Breaker）**：`callLlm`（`providers.ts:140`）在上游宕机时，每个请求都要等满 30s 超时（重试一次则 ~60s）才失败。高并发下这些悬挂请求占用内存、sockets、Prisma 连接，把同进程的文章/话题/登录全部拖慢——**LLM 故障传导为全站故障**。熔断器在连续失败 N 次后「开路」，后续请求**立即** 503 快速失败，给上游恢复时间；冷却后半开试探，成功即恢复。

**舱壁（Bulkhead / 并发上限）**：`agentLimiter` 是 per-IP 40/min。100 个不同 IP 同时打 Agent 端点 = 100 个并发 LLM 调用 + 100 组 `loadUserContext` 三条 DB 查询，上游与 SQLite 都会被压垮。全局信号量把并发 LLM 调用钳制在上限内，超出排队 5s，仍无位则快速 503（**降级而非堆积**）。

> 为什么放在 `lib/llm/` 而不是路由层：所有 LLM 出口都收敛在 `callLlm`/`streamLlm` 两个函数（悬停/对话/tool-loop/test-llm 都走这里），在这两个出口挂 R-01/R-02 即可**一次覆盖全部调用方**，无需改任何路由。

#### 改动 1：新建 `apps/api/src/lib/llm/resilience.ts`

```ts
/**
 * R-01 LLM 熔断器 + R-02 全局并发舱壁（单进程内）。
 *
 * 设计要点：
 * - 熔断按 provider（id::baseUrl）隔离：BYOK 用户各自独立，服务端 Provider 共享；
 * - 只有「上游真坏了」才计数（5xx/网络/超时 408）；4xx 是调用方配置问题，不熔断；
 * - half-open 只放行一个探测请求，成功即闭合，失败重开；
 * - 舱壁是进程级信号量：超出上限排队 LLM_QUEUE_WAIT_MS，仍无位则快速 503（降级不堆积）；
 * - 多副本部署时每实例独立计数（可接受的弱一致，见 docs 报告 P2-4）。
 */
import { logger } from '../logger.js';
import { LlmCallError, isAbortError, isRetriable } from './providerHttp.js';

type CircuitState = 'closed' | 'open' | 'half_open';

interface Circuit {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt: number;
  probeInFlight: boolean;
}

/** 连续失败多少次后开路（可用 LLM_CIRCUIT_FAILURES 覆盖） */
const FAILURE_THRESHOLD = Math.max(
  1,
  parseInt(process.env.LLM_CIRCUIT_FAILURES || '3', 10) || 3,
);
/** 开路冷却时长（可用 LLM_CIRCUIT_OPEN_MS 覆盖） */
const OPEN_MS = Math.max(
  1000,
  parseInt(process.env.LLM_CIRCUIT_OPEN_MS || '30000', 10) || 30000,
);

const circuits = new Map<string, Circuit>();

function circuitKey(provider: { id: string; baseUrl: string }): string {
  return `${provider.id}::${provider.baseUrl}`;
}

/** 该错误是否算「上游故障」（熔断计数口径：5xx/网络层/超时；主动取消与 4xx 不算） */
function isProviderFault(err: unknown): boolean {
  if (err instanceof LlmCallError) return isRetriable(err) || err.status === 408;
  if (err instanceof TypeError) return true; // fetch 网络层失败
  return false;
}

/**
 * 调用前检查：开路中 → 立即 503 快速失败；冷却到 → 转半开并放行一个探测。
 * 探测在飞时，其余请求快速失败（不并发探测）。
 */
export function assertCircuitClosed(provider: { id: string; baseUrl: string }): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);
  if (!c || c.state === 'closed') return;

  if (c.state === 'open') {
    if (Date.now() - c.openedAt < OPEN_MS) {
      throw new LlmCallError(503, '模型暂时不可用（熔断保护中），请稍后重试', { url: '', raw: '' });
    }
    c.state = 'half_open';
    c.probeInFlight = false;
    logger.info({ event: 'llm_circuit_half_open', provider: key }, 'llm circuit half-open');
  }

  if (c.probeInFlight) {
    throw new LlmCallError(503, '模型恢复探测中，请稍后重试', { url: '', raw: '' });
  }
  c.probeInFlight = true;
}

export function recordProviderSuccess(provider: { id: string; baseUrl: string }): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);
  if (c && c.state !== 'closed') {
    logger.info({ event: 'llm_circuit_closed', provider: key }, 'llm circuit closed');
  }
  circuits.delete(key);
}

export function recordProviderFailure(provider: { id: string; baseUrl: string }, err: unknown): void {
  const key = circuitKey(provider);
  const c = circuits.get(key);

  // 半开探测结束：故障类错误 → 重开；非故障类（如客户端断开的主动取消）→ 解除探测标记，保持半开
  if (c?.state === 'half_open') {
    c.probeInFlight = false;
    if (isProviderFault(err)) {
      c.state = 'open';
      c.openedAt = Date.now();
      logger.warn({ event: 'llm_circuit_reopen', provider: key }, 'llm circuit re-opened');
    }
    return;
  }

  if (!isProviderFault(err) || isAbortError(err)) return;

  const next: Circuit = c || {
    state: 'closed',
    consecutiveFailures: 0,
    openedAt: 0,
    probeInFlight: false,
  };
  next.consecutiveFailures += 1;
  if (next.consecutiveFailures >= FAILURE_THRESHOLD) {
    next.state = 'open';
    next.openedAt = Date.now();
    logger.warn(
      {
        event: 'llm_circuit_open',
        provider: key,
        failures: next.consecutiveFailures,
        openMs: OPEN_MS,
      },
      'llm circuit opened',
    );
  }
  circuits.set(key, next);
}

/** 仅测试用：清空全部熔断状态 */
export function resetCircuits(): void {
  circuits.clear();
}

// ---------------- R-02 并发舱壁 ----------------

/** 进程内最大并发 LLM 调用数（可用 LLM_MAX_CONCURRENT 覆盖） */
const MAX_CONCURRENT = Math.max(
  1,
  parseInt(process.env.LLM_MAX_CONCURRENT || '12', 10) || 12,
);
/** 排队等位时长，超时快速 503（可用 LLM_QUEUE_WAIT_MS 覆盖） */
const QUEUE_WAIT_MS = Math.max(
  0,
  parseInt(process.env.LLM_QUEUE_WAIT_MS || '5000', 10) || 5000,
);

let inFlight = 0;
const waiters: Array<{ resolve: () => void }> = [];

function makeRelease(): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    inFlight -= 1;
    // 名额直接移交给队首等待者，避免惊群竞争
    const next = waiters.shift();
    if (next) {
      inFlight += 1;
      next.resolve();
    }
  };
}

/**
 * 获取一个 LLM 并发名额；返回释放函数（必须 finally 调用）。
 * 满员时排队 LLM_QUEUE_WAIT_MS；超时抛 503——降级而非无限堆积。
 */
export async function acquireLlmSlot(): Promise<() => void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return makeRelease();
  }
  await new Promise<void>((resolve, reject) => {
    const entry = {
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    };
    const timer = setTimeout(() => {
      const i = waiters.indexOf(entry);
      if (i >= 0) waiters.splice(i, 1);
      reject(new LlmCallError(503, 'AI 服务繁忙，请稍后重试', { url: '', raw: '' }));
    }, QUEUE_WAIT_MS);
    waiters.push(entry);
  });
  return makeRelease();
}

/** 仅测试/观测用 */
export function llmSlotStats(): { inFlight: number; queued: number; max: number } {
  return { inFlight, queued: waiters.length, max: MAX_CONCURRENT };
}
```

#### 改动 2：接入 `apps/api/src/lib/llm/providers.ts`

**(a)** 顶部 import 区追加：

```ts
import {
  acquireLlmSlot,
  assertCircuitClosed,
  recordProviderFailure,
  recordProviderSuccess,
} from './resilience.js';
```

**(b)** `callLlm`（现状 `providers.ts:140-227`）：在函数体最前面、拿到 `p` 之后插入熔断+舱壁；在成功返回前记成功、catch 里记失败。改动后的函数骨架（**只标注插入位置，其余代码保持原样**）：

```ts
export async function callLlm(req: LlmRequest, provider?: ProviderConfig | null): Promise<LlmResponse> {
  const p = provider || getDefaultProvider();
  if (!p) {
    throw new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  }

  // R-01：熔断开路时快速失败，不给垂死上游继续加压
  assertCircuitClosed(p);
  // R-02：进程级并发名额；满员排队 LLM_QUEUE_WAIT_MS，超时 503 降级
  const releaseSlot = await acquireLlmSlot();

  const { req: timedReq, timedOut } = withTimeout(req);
  const startedAt = Date.now();
  try {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // ……原有 switch 调用逻辑一字不动……
        let result: LlmResponse;
        switch (p.format) {
          case 'anthropic_messages':
            result = await callAnthropicMessages(p, timedReq);
            break;
          case 'openai_responses':
            result = await callOpenAiResponses(p, timedReq);
            break;
          case 'openai_chat':
          default:
            result = await callOpenAiChat(p, timedReq);
            break;
        }
        logger.info(
          { event: 'llm_call', providerId: p.id, format: p.format, mode: req.mode, ms: Date.now() - startedAt, ok: true },
          'llm call ok',
        );
        // R-01：成功复位熔断
        recordProviderSuccess(p);
        return result;
      } catch (e) {
        if (attempt === 1 && !timedOut() && isRetriable(e)) {
          // ……原有重试日志与 sleep 一字不动……
          logger.warn(
            { event: 'llm_call_retry', providerId: p.id, format: p.format, mode: req.mode, status: e instanceof LlmCallError ? e.status : undefined },
            'llm call retry',
          );
          await sleep(LLM_RETRY_BACKOFF_MS);
          continue;
        }
        // R-01：最终失败计入熔断（内部已过滤 4xx/主动取消）
        recordProviderFailure(p, e);
        if (isAbortError(e) && timedOut()) {
          logger.error(
            { event: 'llm_call', providerId: p.id, format: p.format, mode: req.mode, ms: Date.now() - startedAt, ok: false, status: 408 },
            'llm call timeout',
          );
          throw new LlmCallError(408, '模型响应超时，请稍后重试', { url: '', raw: '' });
        }
        // ……原有失败日志一字不动……
        logger.error(
          { event: 'llm_call', providerId: p.id, format: p.format, mode: req.mode, ms: Date.now() - startedAt, ok: false, status: e instanceof LlmCallError ? e.status : e instanceof TypeError ? 'NETWORK' : undefined },
          'llm call failed',
        );
        throw e;
      }
    }
    /* istanbul ignore next -- 循环上限内必返回或抛错 */
    throw new Error('unreachable');
  } finally {
    releaseSlot();
  }
}
```

**(c)** `streamLlm`（现状 `providers.ts:230-264`）整体替换为：

```ts
/** 流式输出：thinking / text 分片。openai_responses 退化为整段 text。 */
export async function* streamLlm(
  req: LlmRequest,
  provider?: ProviderConfig | null,
): AsyncGenerator<StreamChunk, void, unknown> {
  const p = provider || getDefaultProvider();
  if (!p) {
    throw new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  }

  // R-01 + R-02：熔断检查 + 名额占满整个流式生命周期
  assertCircuitClosed(p);
  const releaseSlot = await acquireLlmSlot();

  // A-02：流式同样挂超时，避免上游挂起拖垮 SSE
  const { req: timedReq, timedOut } = withTimeout(req);
  let finished = false;
  try {
    if (p.format === 'anthropic_messages') {
      yield* streamAnthropicMessages(p, timedReq);
      finished = true;
      return;
    }
    if (p.format === 'openai_chat') {
      yield* streamOpenAiChat(p, timedReq);
      finished = true;
      return;
    }
    // B-04：Responses 格式尚未实现真流式，退化为整段调用后一次性 yield；
    // 首 chunk 延迟 = 整个生成时长，早停对其无效。排障时靠此日志定位。
    logger.warn(
      { providerId: p.id, format: p.format },
      'openai_responses: 未实现真流式，退化为整段输出（早停无效）',
    );
    const full = await callOpenAiResponses(p, timedReq);
    if (full.text) yield { kind: 'text' as const, text: full.text };
    finished = true;
  } catch (e) {
    // R-01：真实故障计入熔断；hover 早停/客户端断开属主动取消，不计（内部已过滤）
    recordProviderFailure(p, e);
    if (isAbortError(e) && timedOut()) {
      throw new LlmCallError(408, '模型响应超时，请稍后重试', { url: '', raw: '' });
    }
    throw e;
  } finally {
    releaseSlot();
    if (finished) recordProviderSuccess(p);
  }
}
```

#### 改动 3：新增测试 `apps/api/src/lib/llm/resilience.test.ts`

```ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  acquireLlmSlot,
  assertCircuitClosed,
  recordProviderFailure,
  recordProviderSuccess,
  resetCircuits,
  llmSlotStats,
} from './resilience.js';
import { LlmCallError } from './providerHttp.js';

const P = { id: 'stepfun', baseUrl: 'https://api.stepfun.com/step_plan' };
const serverError = new LlmCallError(502, 'bad gateway', { url: '', raw: '' });
const clientError = new LlmCallError(400, 'bad request', { url: '', raw: '' });

describe('R-01 circuit breaker', () => {
  beforeEach(() => resetCircuits());

  it('连续失败达阈值后开路，快速 503', () => {
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    expect(() => assertCircuitClosed(P)).toThrowError(/熔断保护中/);
  });

  it('4xx 不计入熔断', () => {
    for (let i = 0; i < 10; i++) recordProviderFailure(P, clientError);
    expect(() => assertCircuitClosed(P)).not.toThrow();
  });

  it('成功后复位', () => {
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    recordProviderSuccess(P);
    expect(() => assertCircuitClosed(P)).not.toThrow();
  });

  it('不同 provider 相互隔离', () => {
    for (let i = 0; i < 3; i++) recordProviderFailure(P, serverError);
    expect(() =>
      assertCircuitClosed({ id: 'openai', baseUrl: 'https://api.openai.com/v1' }),
    ).not.toThrow();
  });
});

describe('R-02 bulkhead', () => {
  it('名额获取与释放', async () => {
    const r1 = await acquireLlmSlot();
    expect(llmSlotStats().inFlight).toBeGreaterThan(0);
    r1();
  });
});
```

`.env.example` 追加（放在 `# Agent tool-loop` 段之后）：

```bash
# LLM 韧性（R-01/R-02，可选，有默认值）
# LLM_CIRCUIT_FAILURES=3        # 连续失败 N 次熔断
# LLM_CIRCUIT_OPEN_MS=30000     # 熔断冷却，期间快速 503
# LLM_MAX_CONCURRENT=12         # 进程内最大并发 LLM 调用
# LLM_QUEUE_WAIT_MS=5000        # 并发满员排队等位，超时 503
```

#### 验证

1. `npm test --workspace=@agentforge/api` 全绿（新测试 + 既有 `providers.test.ts`）。
2. 故障演练：把 `STEPFUN_API_KEY` 改成错误值（产生 401，属 4xx）→ Agent 端点正常报错但**不熔断**；把 `STEPFUN_BASE_URL` 指向 `http://127.0.0.1:9`（网络失败）→ 连续 3 次请求后日志出现 `llm_circuit_open`，第 4 次请求**立即** 503（ms 个位数），同时 `curl http://localhost:3001/api/v1/articles?pageSize=1` 仍正常。
3. 并发演练：`LLM_MAX_CONCURRENT=2` 重启，并发 5 个 `/agent/chat/stream`，第 3~5 个在 5s 排队后 503「AI 服务繁忙」，前 2 个正常流式。

---

### P0-5 优雅关闭 + 健康/就绪分离（R-03）

#### 为什么改

- `index.ts` 全文 10 行：**无 SIGTERM/SIGINT 处理**。容器滚动发布/K8s 摘 Pod 时进程被直接杀死：in-flight SSE 硬断、Prisma 连接不释放、SQLite 写可能截断。
- `/health` 在 `generalLimiter`（`app.ts:67`）之后挂载：LB 高频探测会消耗 120/min 预算，**健康检查自己被 429 → LB 摘流 → 假性宕机**。
- `/health` 是浅检查（`{ok:true}`）：进程活着但 DB 挂了也报健康，LB 无法区分「liveness」与「readiness」。

#### 改动 1：整体替换 `apps/api/src/index.ts`

```ts
import 'dotenv/config';
import { createApp } from './app.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { validateEnv } from './lib/env.js';

const port = Number(process.env.PORT || 3001);

// R-07：启动期 env 校验——关键依赖缺失直接拒启动；可选依赖（LLM）warn 降级不阻断
validateEnv();

const app = createApp();
const server = app.listen(port, () => {
  logger.info({ port }, 'agentforge-api listening');
});

/**
 * R-03：优雅关闭——先停止接新连接，宽限在途请求完成，再断开 Prisma。
 * K8s/compose 滚动发布默认发 SIGTERM；超时兜底强退，防止悬挂连接卡住退出。
 */
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown: stop accepting new connections');

  // 兜底：10s 内退不干净就强退（不等待 LLM 上游 30s 超时自然结束）
  const forceTimer = setTimeout(() => {
    logger.error({ signal }, 'shutdown: forced exit after grace period');
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close(async () => {
    try {
      await prisma.$disconnect();
      logger.info('shutdown: prisma disconnected, bye');
      process.exit(0);
    } catch (e) {
      logger.error({ err: String(e) }, 'shutdown: prisma disconnect failed');
      process.exit(1);
    }
  });

  // Node ≥18.2：立刻结束空闲 keep-alive 连接；SSE 等在途连接由宽限期与兜底 timer 处理
  server.closeIdleConnections?.();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
```

#### 改动 2：新建 `apps/api/src/lib/env.ts`（P1-4 提前说明，与 R-03 同批落地）

```ts
/**
 * R-07：启动期环境校验。
 * 原则：关键依赖 fail-fast（启动即失败并打印原因）；可选依赖 warn 降级（不阻断启动）。
 * - 关键：JWT_SECRET（认证全盘依赖）、DATABASE_URL
 * - 可选：LLM Provider（缺失时 Agent 域降级为「仅 BYOK 可用」，其余域正常）
 */
import { logger } from './logger.js';
import { loadProviders } from './llm/providers.js';

export function validateEnv(): void {
  const problems: string[] = [];

  const jwtSecret = process.env.JWT_SECRET || '';
  if (jwtSecret.length < 16) {
    problems.push('JWT_SECRET 未配置或过短（至少 16 字符）');
  }
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd) {
    if (jwtSecret.length < 32) {
      problems.push('生产环境 JWT_SECRET 至少 32 字符');
    }
    if (jwtSecret.includes('change-me')) {
      problems.push('生产环境禁止使用 .env.example 中的示例 JWT_SECRET');
    }
    if (!process.env.DATABASE_URL) {
      problems.push('生产环境必须显式配置 DATABASE_URL');
    }
  }

  if (problems.length) {
    for (const p of problems) logger.error({ problem: p }, 'env validation failed');
    // 关键依赖缺失：拒绝启动。这比「启动成功但运行时全部 500」更诚实、更易排障。
    process.exit(1);
  }

  // 可选依赖：仅提示降级，不阻断
  if (loadProviders().length === 0) {
    logger.warn(
      { event: 'llm_degraded' },
      '未配置任何服务端 LLM Provider：Agent 域降级（仅 BYOK 用户可用），其余功能正常',
    );
  }
}
```

> 注意：`validateEnv` 里调用了 `loadProviders()`，它会缓存结果（B-03 语义不变，只是提前到启动期读一次）。

#### 改动 3：`apps/api/src/app.ts` 健康/就绪分离 + 移出限流

现状（`app.ts:55-71`）：`generalLimiter` 在 `app.use` 之后、`/health` 在其后。

**(a)** 顶部 import 区追加：

```ts
import { prisma } from './lib/prisma.js';
```

**(b)** 把 `/health` 移到 `generalLimiter` **之前**，并新增 `/ready`。即在 `app.use(generalLimiter);`（`app.ts:67`）**之前**插入：

```ts
  // R-03：liveness 浅检查——必须在限流器之前，LB 高频探测不吃限流预算
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'agentforge-api', ts: new Date().toISOString() });
  });

  // R-03：readiness 深检查——DB 不可用时 503，让 LB/编排系统摘流而非打挂
  app.get('/ready', async (_req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.json({ ok: true, db: 'up' });
    } catch {
      res.status(503).json({ ok: false, db: 'down' });
    }
  });
```

**(c)** 删除原来在 `generalLimiter` 之后的旧 `/health`（`app.ts:69-71`）。

#### 验证

1. `npm run dev:api` 启动；`curl http://localhost:3001/health` 与 `/ready` 均 200。
2. 连续 `curl /health` 150 次/分钟：不触发 429（对照：业务路由仍 429）。
3. 临时把 `DATABASE_URL` 改到不存在路径：`/ready` 返回 503，`/health` 仍 200。
4. `kill -TERM <pid>`：日志出现 `shutdown: stop accepting...` → `prisma disconnected, bye`，退出码 0。
5. 临时删 `JWT_SECRET` 启动：进程立即退出并打印原因（对照：LLM env 全空启动，仅 warn，进程正常）。

---

### P0-6 悬停缓存顺序修正 + 缓存读隔离（R-06）

#### 为什么改（两个真实耦合，都在 `/explain` 与 `/explain/stream`）

**问题 A：顺序颠倒。** 现状（`agent.ts:92-95`）：

```ts
const prep = await runExplain(body, req.user?.id);   // ← 内含 resolveProvider，无 Provider 抛 NO_PROVIDER
if (prep.isHover) {
  const cached = await getHoverCache(prep.topic, prep.style);  // ← 永远走不到
```

`runExplain`（`agentOrchestrator.ts:230-233`）先 `resolveProvider` 抛错，后查缓存。**后果：运维撤掉 LLM env 降级运行时，连缓存里已有的悬停讲解也全部失败**——缓存本是最天然的降级层，却被 Provider 配置绑架。正确顺序：**先查缓存（命中即返回，不需要 Provider），未命中才要求 Provider**。

**问题 B：缓存读未隔离。** `getHoverCache`（`hoverCache.ts:30`）的 Prisma 异常会沿路由 try/catch 进 `next(e)` → 500。缓存是优化层不是关键路径：**读失败应视为 miss，降级走 LLM**。

#### 改动 1：`apps/api/src/services/hoverCache.ts` 末尾追加

```ts
/**
 * R-06：缓存读隔离——读失败视为 miss（返回 null），由调用方降级到 LLM。
 * 缓存是优化层，绝不能成为关键路径的单点。
 */
export async function getHoverCacheSafe(topic: string, style: string): Promise<string | null> {
  try {
    return await getHoverCache(topic, style);
  } catch (e) {
    logger.warn({ err: String(e) }, 'hover cache: read failed, degrade to LLM path');
    return null;
  }
}
```

（`logger` 在该文件已 import，无需新增。）

#### 改动 2：`apps/api/src/routes/agent.ts` `/explain`（现状 89-152 行）

把路由体前段：

```ts
    const body = req.body as ExplainBody;
    const prep = await runExplain(body, req.user?.id);

    if (prep.isHover) {
      const cached = await getHoverCache(prep.topic, prep.style);
      if (cached) {
        res.json({ ...cached 响应... });
        return;
      }
    }
```

改为：

```ts
    const body = req.body as ExplainBody;

    // R-06：悬停先查缓存——命中即返回，不需要 LLM Provider；
    // 这样撤销 LLM 配置后，已缓存的讲解仍可服务（缓存即降级层）。
    if (body.mode === 'hover') {
      const preStyle = body.style || 'professional'; // 与 loadUserContext 默认风格一致
      const preCached = await getHoverCacheSafe(body.selection.text, preStyle);
      if (preCached) {
        res.json({
          explanation: preCached,
          mode: body.mode,
          model: 'cache',
          format: 'cache',
          style: preStyle,
          providerId: 'hover-cache',
          cached: true,
          meta: AGENT_MODE_META.fast,
        });
        return;
      }
    }

    const prep = await runExplain(body, req.user?.id);

    if (prep.isHover) {
      // 预查未命中：登录用户偏好风格可能覆盖默认，风格不同则按真实 style 再查一次
      const preChecked = (body.style || 'professional') === prep.style;
      const cached = preChecked ? null : await getHoverCacheSafe(prep.topic, prep.style);
      if (cached) {
        res.json({
          explanation: cached,
          mode: body.mode,
          model: 'cache',
          format: 'cache',
          style: prep.style,
          providerId: 'hover-cache',
          cached: true,
          meta: AGENT_MODE_META.fast,
        });
        return;
      }
    }
```

#### 改动 3：`/explain/stream`（现状 154-354 行）同样处理

在 `initSse(res);` **之前**插入预查（命中走原有 cached 分支直接 `res.end()`），并把原有 `getHoverCache` 调用换成与上面相同的「风格不同才二查 + Safe 版」逻辑。预查插入点：

```ts
      const body = req.body as ExplainBody;

      // R-06：同 /explain——缓存先于 Provider，命中即流式返回缓存
      if (body.mode === 'hover') {
        const preStyle = body.style || 'professional';
        const preCached = await getHoverCacheSafe(body.selection.text, preStyle);
        if (preCached) {
          initSse(res);
          sseWrite(res, {
            type: 'meta',
            model: 'cache',
            format: 'cache',
            providerId: 'hover-cache',
            mode: body.mode,
            style: preStyle,
            cached: true,
            meta: AGENT_MODE_META.fast,
          });
          sseWrite(res, { type: 'final', answer: preCached, thinking: '' });
          sseWrite(res, { type: 'done' });
          res.end();
          return;
        }
      }

      const prep = await runExplain(body, req.user?.id);
      initSse(res);

      if (prep.isHover) {
        const preChecked = (body.style || 'professional') === prep.style;
        const cached = preChecked ? null : await getHoverCacheSafe(prep.topic, prep.style);
        if (cached) {
          // ……原有 cached SSE 分支一字不动……
        }
      }
```

#### 验证

1. `npm test --workspace=@agentforge/api`（`hoverCache.test.ts` + `agent.sse.test.ts`）全绿。
2. 正常配置下悬停两次同一知识点：第二次日志 `hover cache hit`（回归确认）。
3. 删除全部 LLM env 重启：悬停**已缓存**知识点仍返回讲解（`cached: true`）；未缓存知识点返回 NO_PROVIDER 文案——其余页面/接口完全正常。这就是「Agent 降级不扩散」的直接证据。

---

## 3. P1 改造：降级与韧性

---

### P1-1 Provider 故障转移链（R-04）

#### 为什么改

`resolveProvider`（`providers.ts:111`）只返回**一个** Provider：BYOK 优先，否则默认。`loadProviders` 明明支持 StepFun/OpenAI/Generic 三家并存，主 Provider 熔断或故障时却**不会尝试备选**。企业级要求：主备自动 failover，且 BYOK 用户配置了「服务端兜底」时也能受益。

设计决策（要写进代码注释）：

- 故障转移**只在「上游故障类」错误上触发**（5xx/网络/超时 408/429/熔断 503）；4xx 是配置问题，failover 无意义，直接抛。
- BYOK 失败**默认不**回落到服务端 Provider（避免用户配额预期外消耗服务端额度），用 env `LLM_BYOK_FALLBACK_TO_SERVER=1` 显式开启。
- 响应 `providerId` 必须反映**实际服务者**——`callLlmWithFallback` 返回 `{ result, provider }`。

#### 改动 1：`apps/api/src/lib/llm/providers.ts` 追加

```ts
/**
 * R-04：Provider 故障转移链。顺序：BYOK（如启用且允许）→ 首选服务端 → 其余服务端。
 * BYOK 失败默认不回落服务端（配额隔离）；LLM_BYOK_FALLBACK_TO_SERVER=1 显式开启。
 */
export function resolveProviderChain(byok?: ByokConfig | null): ProviderConfig[] {
  const chain: ProviderConfig[] = [];
  const byokP = byokToProvider(byok);
  if (byokP) chain.push(byokP);
  const all = loadProviders();
  if (!byokP || process.env.LLM_BYOK_FALLBACK_TO_SERVER === '1') {
    const preferred = env('LLM_PROVIDER_ID', 'stepfun');
    const sorted = [...all].sort((a, b) =>
      a.id === preferred ? -1 : b.id === preferred ? 1 : 0,
    );
    chain.push(...sorted);
  }
  return chain;
}

export type LlmChainResult = { result: LlmResponse; provider: ProviderConfig };

/**
 * R-04：沿链 failover。仅「上游故障类」错误（5xx/网络/超时/429/熔断 503）触发；
 * 4xx 配置错误直接抛，不 failover。
 */
export async function callLlmWithFallback(
  req: LlmRequest,
  chain: ProviderConfig[],
): Promise<LlmChainResult> {
  let lastErr: unknown = new Error('未配置 LLM：请在设置中填写 BYOK（Base URL / API Key / 模型 / 格式）');
  for (const p of chain) {
    try {
      const result = await callLlm(req, p);
      return { result, provider: p };
    } catch (e) {
      lastErr = e;
      const failover =
        e instanceof TypeError ||
        (e instanceof LlmCallError &&
          [408, 429, 500, 502, 503, 504].includes(e.status));
      logger.warn(
        {
          event: 'llm_failover',
          providerId: p.id,
          status: e instanceof LlmCallError ? e.status : undefined,
          failover,
        },
        'llm provider failed',
      );
      if (!failover) throw e;
    }
  }
  throw lastErr;
}
```

#### 改动 2：`apps/api/src/services/agentOrchestrator.ts`

`runExplain`（230-276）与 `prepareChat`（140-186）中：

```ts
// 现状：
const provider = resolveProvider(ctx.byok);
if (!provider) throw noProviderError();

// 改为：
const chain = resolveProviderChain(ctx.byok);
if (!chain.length) throw noProviderError();
const provider = chain[0]; // 元信息/提示词路径仍用首选；调用走链
```

返回值里**额外带上 `chain`**（`runExplain` 返回对象加 `chain`；`prepareChat` 同理）。`resolveProvider` 的 import 替换为 `resolveProviderChain`。

#### 改动 3：`apps/api/src/routes/agent.ts` 调用点

三处 `callLlm(...)`（`/explain` 约 113 行、`/chat` 约 398 行）与非 react 分支的 `streamLlm`（`/explain/stream` 244 行、`/chat/stream` 527 行）替换：

```ts
// 同步路径现状：
result = await callLlm({ ... }, prep.provider);
// 改为：
const { result: r, provider: servedBy } = await callLlmWithFallback({ ... }, prep.chain);
result = r;
```

响应 JSON 中 `providerId: prep.provider.id` 改为 `providerId: servedBy.id`。流式路径同理包一层 `streamLlmWithFallback`（结构与同步版相同：逐 provider 尝试，仅首包前失败才 failover——**已开始产出 chunk 的流不再 failover**，避免双份内容；实现上 failover 只包住「创建 generator 到首个 next()」阶段，或简单约定：流式只对 `assertCircuitClosed` 抛出的 503 做 failover，其余照旧）。

> 简化实现建议（写进 TODO 注释）：流式 failover 第一版只覆盖「熔断 503」一种情况，约 20 行；其余场景留待 tool-loop 原生 tools API 化时一并重构（`docs/roadmap/tool-loop-roadmap.md`）。

`.env.example` 追加：

```bash
# R-04：BYOK 失败时是否回落服务端 Provider（默认关，配额隔离）
# LLM_BYOK_FALLBACK_TO_SERVER=1
```

#### 验证

1. 配置两个 Provider（STEPFUN + OPENAI，STEPFUN 的 BASE_URL 指向 `http://127.0.0.1:9`）：`/agent/chat` 日志出现 `llm_failover providerId=stepfun failover=true`，响应 `providerId=openai`，回答正常。
2. 只改坏 KEY（401）：直接报错，**无** failover 日志。

---

### P1-2 tool-loop 整体 deadline（R-08）

#### 为什么改

`runToolLoop`（`toolLoop.ts:69-141`）每轮 `callLlm` 各自 30s 超时 + 工具 8s，5 轮最坏 ≈190s。前端 tools 模式 90s 超时（`useAgentPanel.ts:207`）后断开，服务端却继续空跑烧 token。需要**循环级总时限**，默认 75s（< 前端 90s，留出发送 final 的余量）。

#### 改动 1：`apps/api/src/lib/llm/config.ts` 追加

```ts
/** ReAct tool-loop 整体时限（R-08）：须小于前端 tools 模式超时 90s，留出 final 余量 */
export const TOOL_LOOP_OVERALL_MS = Math.max(
  5000,
  parseInt(process.env.TOOL_LOOP_OVERALL_MS || '75000', 10) || 75000,
);
```

#### 改动 2：`apps/api/src/lib/llm/tools/toolLoop.ts`

`runToolLoop` 函数体（56 行起）做三处小改：

**(a)** 循环前创建总时限信号并与外层信号合并：

```ts
  // R-08：循环级总时限——防止 5 轮 × (30s LLM + 8s 工具) ≈ 190s 空跑
  const overallMs = opts.overallTimeoutMs ?? TOOL_LOOP_OVERALL_MS;
  const deadlineSignal = AbortSignal.timeout(overallMs);
  const loopSignal =
    opts.signal && typeof AbortSignal.any === 'function'
      ? AbortSignal.any([opts.signal, deadlineSignal])
      : opts.signal || deadlineSignal;
```

`RunToolLoopOpts` 类型加 `overallTimeoutMs?: number;`。

**(b)** 循环内所有 `opts.signal` 引用改为 `loopSignal`（`callLlm` 的 `signal:` 与 `toolSignal(...)` 的第一个参数）。

**(c)** 循环顶部已有 `opts.signal?.aborted` 检查保留，**额外**在 `callLlm` 抛 `AbortError`/`LlmCallError(408)` 且 `deadlineSignal.aborted` 时，返回「部分答案 + 时限说明」而不是上抛：

```ts
    } catch (e) {
      // R-08：总时限触顶——优雅收尾，告知用户可缩小范围重试；不当作系统故障
      if (deadlineSignal.aborted && !opts.signal?.aborted) {
        logger.warn({ event: 'tool_loop_deadline', iterations: i + 1 }, 'tool loop deadline');
        const answer = '这个问题涉及的检索步骤较多，已超过本轮时限。请缩小问题范围，或关闭「允许工具」直接提问。';
        opts.onEvent?.({ type: 'delta', text: answer });
        return { answer, thinking: lastThinking, model, format, iterations: i + 1, hitMaxIters: true };
      }
      throw e;
    }
```

（即把 `const result = await callLlm(...)` 包进 try/catch；保持其余逻辑不变。）

`.env.example` 的 tool-loop 段追加 `# TOOL_LOOP_OVERALL_MS=75000`。

#### 验证

`TOOL_LOOP_MAX_ITERS=5 TOOL_LOOP_OVERALL_MS=15000` 重启，用一个必然触发多轮检索的问题：`/agent/chat/stream`（tools 模式）在 ~15s 收到时限文案的 `final` 而非悬挂。

---

### P1-3 SSE 心跳（R-05）

#### 为什么改

`initSse`（`sse.ts:7-13`）之后，deep 模式首 token 可能超过 60s（尤其 `openai_responses` 退化为整段调用，B-04）。Nginx 默认 `proxy_read_timeout 60s` 会切断「静默」连接——**用户看到的是流式中断，实际后端还在正常生成**。行业标准做法：每 15s 发一行 SSE 注释 `: ping`（前端 `agentStream.ts:92` 只认 `data:` 前缀，注释行天然被忽略，**契约零变化**）。

#### 改动 1：`apps/api/src/lib/sse.ts` 追加

```ts
/**
 * R-05：SSE 心跳——每 intervalMs 写一行注释，防止反代/NAT 空闲断连。
 * 返回停止函数，必须在响应收尾处调用。前端只解析 data: 行，注释天然忽略，契约不变。
 */
export function startSseHeartbeat(res: Response, intervalMs = 15_000): () => void {
  const timer = setInterval(() => {
    if (res.writableEnded || res.destroyed) return;
    try {
      res.write(': ping\n\n');
    } catch {
      /* 连接已异常，收尾逻辑会处理 */
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
```

#### 改动 2：`apps/api/src/routes/agent.ts` 两个流式端点

`/explain/stream` 与 `/chat/stream` 中，`initSse(res);` 之后立即：

```ts
      const stopHeartbeat = startSseHeartbeat(res);
```

两端点最外层 `finally`（即 `// B-10：统一收尾` 那个 finally）内、`res.end()` 之前加：

```ts
      stopHeartbeat();
```

#### 验证

Nginx（或 `proxy_read_timeout 5s` 的本地反代）后访问 deep 流式讲解：>60s 的生成不再断流；DevTools EventStream 中看不到任何 ping 干扰渲染。

---

### P1-4 启动期 env 校验（R-07）

**已在 P0-5 改动 2 给出完整代码**（`apps/api/src/lib/env.ts`），此处只补原则：

| 依赖 | 级别 | 缺失行为 |
|------|------|----------|
| `JWT_SECRET`（≥16，生产 ≥32 且非示例值） | 关键 | **拒绝启动**，打印原因 |
| `DATABASE_URL`（生产必须显式） | 关键 | 拒绝启动 |
| LLM Provider env | 可选 | warn 降级启动，Agent 域对无 BYOK 用户返回 NO_PROVIDER 文案，**其余域完全正常** |
| `CORS_ORIGIN` / `TRUST_PROXY` / `LOG_LEVEL` | 有安全默认 | 不校验 |

这就是「启动时脱耦」的落地：**任何单一可选服务（LLM/MCP）的配置问题永远不阻止进程为其余 8 个业务域服务。**

---

### P1-5 Agent 限流分桶（R-10）

#### 为什么改

现状 `agentLimiter` 单桶 40/min/IP（`app.ts:73-77`）覆盖全部 `/api/v1/agent/*`：

1. **悬停扫射耗尽对话配额**：前端悬停防扫射窗口是 8 次/10s（`AgentFloat.tsx:106`），持续扫文 = 48/min > 40/min 桶——重度阅读会把同一 IP 的对话也 429 掉。
2. **缓存命中也消耗限流预算**（限流是中间件，先于缓存检查）：纯属浪费。

分桶原则：**高频低成本的悬停走宽桶，高频高成本的对话走窄桶，写操作走最窄桶**。

#### 改动：`apps/api/src/app.ts`

现状（`app.ts:73-77` + `app.ts:85`）：

```ts
  const agentLimiter = rateLimit({
    windowMs: 60_000,
    max: 40,
    message: { error: { code: 'RATE_LIMIT', message: 'Agent 请求过于频繁' } },
  });
  ...
  app.use('/api/v1/agent', agentLimiter, agentRouter);
```

改为（R-10）：

```ts
  // R-10：Agent 限流分桶——悬停（高频低成本，多命中缓存）与对话（低频高成本）隔离，
  // 避免悬停扫射耗尽对话配额；桶仍是 per-IP，全局并发由 R-02 舱壁兜底。
  const agentHoverLimiter = rateLimit({
    windowMs: 60_000,
    max: 90,
    message: { error: { code: 'RATE_LIMIT', message: '讲解请求过于频繁，请稍后再试' } },
  });
  const agentChatLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '对话请求过于频繁，请稍后再试' } },
  });
  const agentWriteLimiter = rateLimit({
    windowMs: 60_000,
    max: 20,
    message: { error: { code: 'RATE_LIMIT', message: '操作过于频繁，请稍后再试' } },
  });
  ...
  app.use('/api/v1/agent', agentRouter);
```

`apps/api/src/routes/agent.ts` 内按端点挂桶（顶部 import `rateLimit from 'express-rate-limit';`，桶定义移到该文件或从 app.ts 导出——**推荐移到 agent.ts**，保持 app.ts 只做装配）：

```ts
agentRouter.post('/explain', agentHoverLimiter, optionalAuth, validate(explainSchemaFixed), ...);
agentRouter.post('/explain/stream', agentHoverLimiter, optionalAuth, validate(explainSchemaFixed), ...);
agentRouter.post('/chat', agentChatLimiter, optionalAuth, validate(chatSchema), ...);
agentRouter.post('/chat/stream', agentChatLimiter, optionalAuth, validate(chatSchema), ...);
agentRouter.post('/memory', agentWriteLimiter, requireAuth, ...);
agentRouter.post('/progress', agentWriteLimiter, requireAuth, ...);
agentRouter.post('/cache/clear', agentWriteLimiter, requireAuth, requireRole('admin'), ...);
// GET /meta、/providers、/memory 只读轻量，不挂 Agent 桶（仍受 generalLimiter 约束）
```

#### 验证

悬停扫文 2 分钟（>40 次讲解）后，立即发起对话：对话正常（分桶前会 429）。

---

## 4. P2 改造：规模化与治理

---

### P2-1 hover 用户上下文短缓存

#### 为什么改

`loadUserContext`（`agentMemory.ts:66-120`）每次执行 3 条 DB 查询 + BYOK 解密。悬停是**全站最高频端点**（每次悬停未命中 L1/L2 都走一遍），登录重度用户扫文时对 SQLite 形成稳定放大压力。而记忆/进度在 60s 内几乎不变——短 TTL 进程内缓存是标准解法。

#### 改动：`apps/api/src/services/agentMemory.ts`

```ts
/** R-11：hover 高频路径用户上下文短缓存（进程内，TTL 60s）；设置变更时主动失效 */
const CTX_TTL_MS = 60_000;
type UserCtx = Awaited<ReturnType<typeof loadUserContextInner>>;
const ctxCache = new Map<string, { at: number; value: UserCtx }>();

export function invalidateUserContext(userId: string): void {
  for (const k of [...ctxCache.keys()]) if (k.startsWith(`${userId}::`)) ctxCache.delete(k);
}

export async function loadUserContext(userId?: string, route?: string) {
  if (!userId) return loadUserContextInner(userId, route);
  const key = `${userId}::${route || ''}`;
  const hit = ctxCache.get(key);
  if (hit && Date.now() - hit.at < CTX_TTL_MS) return hit.value;
  const value = await loadUserContextInner(userId, route);
  ctxCache.set(key, { at: Date.now(), value });
  return value;
}

// 原 loadUserContext 函数体重命名为 loadUserContextInner，逻辑一字不动
```

在 `settings.ts` 的 `PATCH /me` 成功保存偏好后调用 `invalidateUserContext(req.user!.id)`。

> 多副本部署时 TTL 60s 是最坏不一致窗口（与 B-03 环境变量不热更的取舍一致），文档化即可。

### P2-2 hoverCache 表定期清理

#### 为什么改

`hoverCache.ts` 只有**读时惰性过期**：永不再次被查的 key 永久滞留，表无限增长。复用 B-07 同款节流模式（`agentConversation.ts:22-35`）：

```ts
// hoverCache.ts 追加
let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 30 * 60 * 1000;
const HARD_RETENTION_MS = 7 * 24 * 60 * 60 * 1000; // 7 天硬保留期

/** R-12：节流清理过期悬停缓存（30 分钟至多一次，不阻塞主链路） */
export function maybePruneHoverCache(): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) return;
  lastPruneAt = now;
  void prisma.hoverExplainCache
    .deleteMany({ where: { updatedAt: { lt: new Date(now - HARD_RETENTION_MS) } } })
    .then((r) => r.count && logger.info({ event: 'hover_cache_prune', count: r.count }, 'hover cache pruned'))
    .catch((e) => logger.warn({ err: String(e) }, 'hover cache prune failed'));
}
```

在 `getHoverCacheSafe` 第一行调用 `maybePruneHoverCache()`。

### P2-3 前端 Agent 熔断降级

#### 为什么改

后端熔断后，前端悬停仍会**每次悬停都发起请求**再拿到 503——扫文用户持续给恢复中的后端施压。前端需要一个对称的轻量熔断：连续失败后**静默暂停预取**一段时间。

#### 改动：`apps/web/src/lib/hoverExplainSession.ts` 追加

```ts
/**
 * R-09 配套：前端 Agent 熔断。连续 3 次失败 → 暂停预取 2 分钟（静默降级：
 * 悬停不再出气泡，面板仍可用并显示错误文案）。成功一次即复位。
 */
const FAIL_THRESHOLD = 3;
const SUSPEND_MS = 2 * 60 * 1000;
let consecutiveFails = 0;
let suspendedUntil = 0;

export function agentSuspended(): boolean {
  return Date.now() < suspendedUntil;
}

export function recordAgentSuccess(): void {
  consecutiveFails = 0;
  suspendedUntil = 0;
}

export function recordAgentFailure(): void {
  consecutiveFails += 1;
  if (consecutiveFails >= FAIL_THRESHOLD) {
    suspendedUntil = Date.now() + SUSPEND_MS;
  }
}
```

接线：`runHoverExplainStream`（`hoverExplainSession.ts:146`）成功路径调 `recordAgentSuccess()`，catch 路径调 `recordAgentFailure()`；`AgentFloat.tsx` 发起预取前（`fire` 附近，约 430 行）加：

```ts
if (agentSuspended()) return; // R-09：熔断窗口内静默不预取
```

### P2-4 多实例部署说明 + Redis 预留（仅文档与 env 约定）

单进程韧性组件（R-01/R-02/限流）在 **N 副本时各自独立计数**，语义变为：

| 组件 | 单实例语义 | N 副本语义 | 对策 |
|------|-----------|-----------|------|
| R-02 舱壁 | 全局 ≤12 并发 | 每实例 ≤12（总量 ×N） | 按副本数下调 `LLM_MAX_CONCURRENT`（如 3 副本设 4） |
| R-01 熔断 | 全局熔断 | 每实例独立熔断（有实例滞后半开） | 可接受；需强一致时换 Redis 共享状态 |
| 限流 | per-IP 全局限额 | per-IP per-实例（实际 ÷N） | `rate-limit-redis` store；接口已是 express-rate-limit 标准 `stores` 选项，改动 <20 行，**需要时再上** |
| hoverCache L2 / 会话 / 记忆 | DB 共享 | 天然共享 | 无需改 |
| 认证 | 无状态 JWT | 天然横向 | 无需 sticky session |

**扩容判断标准**（写进运维文档）：单进程 event loop 延迟 p99 >100ms、或 CPU 持续 >70%、或 `/ready` 抖动 → 先垂直扩容；再不够 → Postgres（`docs/operations/postgres.md`）+ 多副本 + Redis store。

### P2-5 docker-compose 完整化 + 死目录清理

**(a)** `docker-compose.yml` 追加 api 服务（web 建议静态托管或另起 nginx，不在本文件强耦合）：

```yaml
  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile   # 需新增：node:20-alpine → npm ci → build → prisma generate → node dist/index.js
    container_name: agentforge-api
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: 3001
      DATABASE_URL: postgresql://agentforge:agentforge@postgres:5432/agentforge?schema=public
      JWT_SECRET: ${JWT_SECRET:?must set JWT_SECRET}
      CORS_ORIGIN: ${CORS_ORIGIN:-http://localhost:5280}
      STEPFUN_API_KEY: ${STEPFUN_API_KEY:-}
    ports:
      - '3001:3001'
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ['CMD-SHELL', 'wget -qO- http://127.0.0.1:3001/ready || exit 1']
      interval: 10s
      timeout: 3s
      retries: 6
```

（`JWT_SECRET: ${JWT_SECRET:?...}` 与 R-07 双重保障：编排层缺关键 env 直接起不来。）

**(b)** 删除根 `api/` 空死目录（2026-08-04 报告 D-01 遗留，本次一并清理）：`git rm -r api`。`_legacy/` 的 git 跟踪矛盾（D-02）按前报告决策执行，不在本报告重复。

---

## 5. 高并发能力总评与演进路线

| 阶段 | 触发条件 | 动作 |
|------|----------|------|
| 现状（单进程 SQLite） | 日活 <1k，Agent QPS <2 | 本报告 P0/P1 落地后即达标 |
| 阶段 2（单进程 + PG） | DB 锁竞争、`/ready` 抖动 | 按 `docs/operations/postgres.md` 切 PostgreSQL；`DATABASE_URL` 加 `connection_limit=10` |
| 阶段 3（多副本） | 单核 CPU >70%、event loop p99 >100ms | P2-4：N 副本 + 限流/熔断参数 ÷N 或 Redis store；LB 打 `/ready` 摘流 |
| 阶段 4（Agent 独立服务） | Agent QPS > 内容域 10 倍，或工具链变重 | 把 `services/agent` 占位落实：`agentOrchestrator`/`lib/llm` 已自成闭环（仅依赖 prisma + shared），**平移成本 < 2d**；API 契约（SSE 事件协议）不变，前端无感 |

关键架构结论：**现在不需要拆微服务**。`apps/api` 内部已经按「路由薄层 → services 业务层 → lib 基础设施」分层，Agent 子系统（`routes/agent.ts` + `services/agent*.ts` + `lib/llm/*`）与内容域的唯一共享点是 PrismaClient 单例和进程本身——P0 的熔断/舱壁/优雅关闭落地后，单进程内的故障隔离已等价于「逻辑多服务」。真正的拆分收益在**独立伸缩**（阶段 4），届时平移即可。

---

## 6. 施工顺序与验证总表

### 6.1 推荐施工顺序（每步独立可交付、独立可回滚）

| 步 | 内容 | 依赖 | 风险 |
|----|------|------|------|
| 1 | P0-1 ErrorBoundary + P0-2 代码分割 | 无 | 低（纯前端，视觉不变） |
| 2 | P0-5 优雅关闭/健康就绪 + P1-4 env 校验 | 无 | 中（**生产弱 JWT 会拒启动**，上线前先核对 env） |
| 3 | P0-3/P0-4 熔断+舱壁 | 无 | 低（默认参数保守：3 次/30s/12 并发） |
| 4 | P0-6 缓存顺序+读隔离 | 无 | 低（行为更宽容） |
| 5 | P1-1 failover 链 | 步骤 3（复用熔断语义） | 中（触及 3 个文件调用点） |
| 6 | P1-2 loop deadline + P1-3 心跳 + P1-5 分桶 | 无 | 低 |
| 7 | P2 全部 | 步骤 3 | 低 |

### 6.2 每步验证命令

```bash
npm run build                       # 全量构建（shared → web → api）
npm test                            # api + shared 全部 Vitest
npm run lint                        # oxlint
npm run dev:api                     # :3001，观察启动日志（R-07 校验输出）
npm run dev:web                     # :5280，逐路由手测
```

### 6.3 故障演练 checklist（上线前必做）

| 演练 | 操作 | 预期 |
|------|------|------|
| 上游宕 | `STEPFUN_BASE_URL=http://127.0.0.1:9` | 3 次后熔断；Agent 快速 503；文章/话题/登录正常；30s 后半开自动恢复 |
| 撤销 LLM | 清空 LLM env 重启 | 仅 warn 启动；已缓存悬停正常；其余域正常 |
| Agent 组件崩溃 | 临时代码 throw | 仅 Agent 静默消失（P0-1 L3） |
| 页面模块崩溃 | 临时代码 throw | 仅该页降级 UI，导航可用（P0-1 L2 + P0-2） |
| 发布滚动 | `kill -TERM` | 日志优雅关闭序列，退出码 0 |
| DB 宕 | 错误 `DATABASE_URL` | `/ready` 503、`/health` 200；进程不崩 |
| 突发并发 | `LLM_MAX_CONCURRENT=2` + 并发 5 流 | 超出者 5s 后 503 降级，不堆积 |

---

## 7. 附：问题-证据索引

| 问题 | 关键证据（文件:行） |
|------|---------------------|
| 无 ErrorBoundary | 全仓 grep 0 命中；`AppShell.tsx:357` 全局挂载 `AgentFloat` |
| 无代码分割 | `router.tsx:3-19`；`dist/assets/index-*.js` 542KB |
| 无熔断/舱壁 | 全仓 grep `circuit|bulkhead|semaphore` 0 命中；`providers.ts:140/230` |
| 缓存顺序颠倒 | `agent.ts:92-95` + `agentOrchestrator.ts:232-233` |
| 缓存读未隔离 | `agent.ts:95` 裸 `await getHoverCache` |
| 无优雅关闭 | `index.ts` 全文 10 行 |
| /health 在限流后 | `app.ts:67` vs `app.ts:69-71` |
| 无就绪探针 | `app.ts:69-71` 浅检查 |
| tool-loop 无总时限 | `toolLoop.ts:69-141`；前端 90s `useAgentPanel.ts:207` |
| SSE 无心跳 | `sse.ts:7-13` |
| 限流单桶 | `app.ts:73-77,85`；前端扫射窗口 `AgentFloat.tsx:104-107` |
| hover 上下文重 DB | `agentMemory.ts:66-120`（3 查询 + 解密/次） |
| 无启动 env 校验 | `jwt.ts:13-19` 运行时懒抛错 |
| 多副本限流弱化 | express-rate-limit v7 MemoryStore 默认 |

---

*报告完。施工时如对某条改动有疑问，以「最小必要改动 + 不破坏既有 A-/B-/C-/D-/I- 不变量」为准；拿不准的取舍先回到本报告 §1.2 故障场景表复核。*
