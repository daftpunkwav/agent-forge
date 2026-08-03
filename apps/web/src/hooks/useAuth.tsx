import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { PublicUser } from '@agentforge/shared';
import { can, isAdminLike, isAuthorLike, roleLabel } from '@agentforge/shared';
import { api, ApiError, clearTokens, getRefreshToken, getToken, setTokens } from '@/lib/api';

interface AuthCtx {
  user: PublicUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** 作者或管理员 */
  isAuthor: boolean;
  isAdmin: boolean;
  isEliteAuthor: boolean;
  isGuest: boolean;
  roleLabel: string;
  can: (perm: Parameters<typeof can>[1]) => boolean;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const { user: u } = await api.me();
      setUser(u);
    } catch (e) {
      // 仅凭证失效（401/403）才清 token 强制登出；网络/5xx 等错误保留登录态
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        clearTokens();
        setUser(null);
      }
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login({ email, password });
    setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const res = await api.register({ email, password, name });
    setTokens(res.accessToken, res.refreshToken);
    setUser(res.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout({ refreshToken: getRefreshToken() });
    } catch {
      /* ignore */
    }
    clearTokens();
    setUser(null);
  }, []);

  const principal = useMemo(
    () =>
      user
        ? {
            role: user.role,
            authorTier: user.authorTier || 'none',
            adminLevel: user.adminLevel ?? 0,
          }
        : { role: 'guest' as const },
    [user],
  );

  const value = useMemo(
    () => ({
      user,
      loading,
      login,
      register,
      logout,
      refresh,
      isAuthor: isAuthorLike(principal),
      isAdmin: isAdminLike(principal, 1),
      isEliteAuthor: user?.role === 'author' && user?.authorTier === 'elite',
      isGuest: !user,
      roleLabel: roleLabel(
        user ? user.role : 'guest',
        user?.authorTier,
        user?.adminLevel,
      ),
      can: (perm: Parameters<typeof can>[1]) => can(principal, perm),
    }),
    [user, loading, login, register, logout, refresh, principal],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
