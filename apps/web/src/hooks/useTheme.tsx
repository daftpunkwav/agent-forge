import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type Theme = 'light' | 'dark';
export type AccentId = 'orange' | 'blue' | 'violet' | 'green' | 'rose' | 'cyan';

export const ACCENTS: { id: AccentId; label: string; swatch: string }[] = [
  { id: 'orange', label: '暖橙', swatch: '#f1481e' },
  { id: 'blue', label: '霁蓝', swatch: '#2563eb' },
  { id: 'violet', label: '青紫', swatch: '#7c3aed' },
  { id: 'green', label: '松绿', swatch: '#059669' },
  { id: 'rose', label: '玫红', swatch: '#e11d48' },
  { id: 'cyan', label: '青碧', swatch: '#0891b2' },
];

interface ThemeCtx {
  theme: Theme;
  accent: AccentId;
  setTheme: (t: Theme) => void;
  setAccent: (a: AccentId) => void;
  toggle: () => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const KEY_THEME = 'agentforge-theme';
const KEY_ACCENT = 'agentforge-accent';

function resolveTheme(): Theme {
  const saved = localStorage.getItem(KEY_THEME) as Theme | null;
  if (saved === 'light' || saved === 'dark') return saved;
  if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function resolveAccent(): AccentId {
  const saved = localStorage.getItem(KEY_ACCENT) as AccentId | null;
  if (saved && ACCENTS.some((a) => a.id === saved)) return saved;
  return 'orange';
}

function applyTheme(t: Theme, accent: AccentId) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  document.documentElement.classList.toggle('light', t === 'light');
  document.documentElement.setAttribute('data-accent', accent);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === 'undefined' ? 'light' : resolveTheme(),
  );
  const [accent, setAccentState] = useState<AccentId>(() =>
    typeof window === 'undefined' ? 'orange' : resolveAccent(),
  );

  useEffect(() => {
    applyTheme(theme, accent);
  }, [theme, accent]);

  const setTheme = useCallback((t: Theme) => {
    localStorage.setItem(KEY_THEME, t);
    setThemeState(t);
  }, []);

  const setAccent = useCallback((a: AccentId) => {
    localStorage.setItem(KEY_ACCENT, a);
    setAccentState(a);
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, accent, setTheme, setAccent, toggle }),
    [theme, accent, setTheme, setAccent, toggle],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
