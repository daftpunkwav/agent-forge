import { lazy, Suspense, type ReactNode } from 'react';

/**
 * 路由级懒加载页面（R-09 配套，与 router.tsx 分离）：
 * - 每个懒页面独立 chunk——单页面模块错误只触发页面边界降级，不再拖垮整站；
 * - 单独文件满足 react-refresh「仅导出组件」约束，router.tsx 只导出 router。
 */
const KnowledgeOverviewPage = lazy(() =>
  import('@/pages/KnowledgeOverviewPage').then((m) => ({ default: m.KnowledgeOverviewPage })),
);
const ArticlePage = lazy(() => import('@/pages/ArticlePage').then((m) => ({ default: m.ArticlePage })));
const LlmOverviewPage = lazy(() =>
  import('@/pages/LlmOverviewPage').then((m) => ({ default: m.LlmOverviewPage })),
);
const LoginPage = lazy(() => import('@/pages/AuthPages').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() =>
  import('@/pages/AuthPages').then((m) => ({ default: m.RegisterPage })),
);
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const NewsPage = lazy(() => import('@/pages/NewsPage').then((m) => ({ default: m.NewsPage })));
const DomainDetailPage = lazy(() =>
  import('@/pages/DomainDetailPage').then((m) => ({ default: m.DomainDetailPage })),
);
const SearchPage = lazy(() => import('@/pages/SearchPage').then((m) => ({ default: m.SearchPage })));
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

export {
  KnowledgeOverviewPage,
  ArticlePage,
  LlmOverviewPage,
  LoginPage,
  RegisterPage,
  ProfilePage,
  SettingsPage,
  NewsPage,
  DomainDetailPage,
  SearchPage,
  DomainsAdminPage,
  AuthorDashboard,
  ArticleEditorPage,
  AnimationEditorPage,
  ApplyAuthorPage,
  ApplicationsAdminPage,
  TopicsPage,
  TopicNewPage,
  TopicDetailPage,
};

/** 懒页面加载中占位：复用现有样式变量，不改视觉体系 */
function PageLoading() {
  return (
    <div className="container" style={{ padding: 64, color: 'var(--muted-foreground)' }}>
      加载中…
    </div>
  );
}

/** 统一包一层 Suspense；渲染期错误由 AppShell 的 L2 页面边界（R-09）兜底 */
export function LazyPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}
