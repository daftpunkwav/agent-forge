import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/hooks/useTheme';
import { AuthProvider } from '@/hooks/useAuth';
import { router } from '@/app/router';
import { ErrorBoundary } from '@/components/layout/ErrorBoundary';
import '@/styles/global.css';

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
