import { createBrowserRouter, Link } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';
import {
  AnimationEditorPage,
  ApplicationsAdminPage,
  ApplyAuthorPage,
  ArticleEditorPage,
  ArticlePage,
  AuthorDashboard,
  DomainDetailPage,
  DomainsAdminPage,
  KnowledgeOverviewPage,
  LazyPage,
  LlmOverviewPage,
  LoginPage,
  NewsPage,
  ProfilePage,
  RegisterPage,
  SearchPage,
  SettingsPage,
  TopicDetailPage,
  TopicNewPage,
  TopicsPage,
} from '@/app/lazyPages';

/**
 * 路由装配（R-09 配套）：
 * - 懒页面组件定义在 lazyPages.tsx（独立 chunk，满足 fast refresh 约束）；
 * - 首页保持 eager（首屏 LCP）；作者/管理端重组件按需加载。
 */
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'knowledge', element: <LazyPage><KnowledgeOverviewPage /></LazyPage> },
      { path: 'knowledge/:slug', element: <LazyPage><ArticlePage /></LazyPage> },
      { path: 'llm', element: <LazyPage><LlmOverviewPage /></LazyPage> },
      { path: 'llm/:slug', element: <LazyPage><ArticlePage /></LazyPage> },
      { path: 'domains/:slug', element: <LazyPage><DomainDetailPage /></LazyPage> },
      { path: 'search', element: <LazyPage><SearchPage /></LazyPage> },
      { path: 'news', element: <LazyPage><NewsPage /></LazyPage> },
      { path: 'topics', element: <LazyPage><TopicsPage /></LazyPage> },
      { path: 'topics/new', element: <LazyPage><TopicNewPage /></LazyPage> },
      { path: 'topics/:id', element: <LazyPage><TopicDetailPage /></LazyPage> },
      { path: 'login', element: <LazyPage><LoginPage /></LazyPage> },
      { path: 'register', element: <LazyPage><RegisterPage /></LazyPage> },
      { path: 'profile', element: <LazyPage><ProfilePage /></LazyPage> },
      { path: 'settings', element: <LazyPage><SettingsPage /></LazyPage> },
      { path: 'admin/domains', element: <LazyPage><DomainsAdminPage /></LazyPage> },
      { path: 'author', element: <LazyPage><AuthorDashboard /></LazyPage> },
      { path: 'author/articles/new', element: <LazyPage><ArticleEditorPage /></LazyPage> },
      { path: 'author/articles/:id/edit', element: <LazyPage><ArticleEditorPage /></LazyPage> },
      { path: 'author/animations/new', element: <LazyPage><AnimationEditorPage /></LazyPage> },
      { path: 'author/animations/:id/edit', element: <LazyPage><AnimationEditorPage /></LazyPage> },
      { path: 'author/apply', element: <LazyPage><ApplyAuthorPage /></LazyPage> },
      { path: 'author/applications', element: <LazyPage><ApplicationsAdminPage /></LazyPage> },
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
