import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/layout/AppShell';
import { HomePage } from '@/pages/HomePage';
import { KnowledgeOverviewPage } from '@/pages/KnowledgeOverviewPage';
import { ArticlePage } from '@/pages/ArticlePage';
import { LlmOverviewPage } from '@/pages/LlmOverviewPage';
import { LoginPage, RegisterPage } from '@/pages/AuthPages';
import { ProfilePage } from '@/pages/ProfilePage';
import { SettingsPage } from '@/pages/SettingsPage';
import { NewsPage } from '@/pages/NewsPage';
import { DomainDetailPage } from '@/pages/DomainDetailPage';
import { SearchPage } from '@/pages/SearchPage';
import { DomainsAdminPage } from '@/pages/admin/DomainsAdminPage';
import { AuthorDashboard } from '@/pages/author/AuthorDashboard';
import { ArticleEditorPage } from '@/pages/author/ArticleEditorPage';
import { AnimationEditorPage } from '@/pages/author/AnimationEditorPage';
import { ApplyAuthorPage } from '@/pages/author/ApplyAuthorPage';
import { ApplicationsAdminPage } from '@/pages/author/ApplicationsAdminPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'knowledge', element: <KnowledgeOverviewPage /> },
      { path: 'knowledge/:slug', element: <ArticlePage /> },
      { path: 'llm', element: <LlmOverviewPage /> },
      { path: 'llm/:slug', element: <ArticlePage /> },
      { path: 'domains/:slug', element: <DomainDetailPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'news', element: <NewsPage /> },
      { path: 'login', element: <LoginPage /> },
      { path: 'register', element: <RegisterPage /> },
      { path: 'profile', element: <ProfilePage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'admin/domains', element: <DomainsAdminPage /> },
      { path: 'author', element: <AuthorDashboard /> },
      { path: 'author/articles/new', element: <ArticleEditorPage /> },
      { path: 'author/articles/:id/edit', element: <ArticleEditorPage /> },
      { path: 'author/animations/new', element: <AnimationEditorPage /> },
      { path: 'author/animations/:id/edit', element: <AnimationEditorPage /> },
      { path: 'author/apply', element: <ApplyAuthorPage /> },
      { path: 'author/applications', element: <ApplicationsAdminPage /> },
    ],
  },
]);
