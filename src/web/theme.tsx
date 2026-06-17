import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

interface ThemePreferenceStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

export const themePreferenceStorageKey = 'gloss:theme-preference';
export const systemThemeMediaQuery = '(prefers-color-scheme: dark)';

const themePreferences: ReadonlySet<string> = new Set(['system', 'light', 'dark']);
const ThemeContext = createContext<ThemeContextValue | null>(null);

export function isThemePreference(value: string | null): value is ThemePreference {
  return Boolean(value && themePreferences.has(value));
}

export function loadThemePreference(
  storage: ThemePreferenceStorage | null = browserStorage()
): ThemePreference {
  if (!storage) {
    return 'system';
  }

  try {
    const storedPreference = storage.getItem(themePreferenceStorageKey);
    return isThemePreference(storedPreference) ? storedPreference : 'system';
  } catch {
    return 'system';
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: ThemePreferenceStorage | null = browserStorage()
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(themePreferenceStorageKey, preference);
  } catch {
    // Ignore storage failures so private browsing or locked-down environments still work.
  }
}

export function resolvedThemeForSystemPreference(prefersDark: boolean): ResolvedTheme {
  return prefersDark ? 'dark' : 'light';
}

export function resolveThemePreference(
  preference: ThemePreference,
  systemTheme: ResolvedTheme
): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference;
}

export function applyDocumentTheme(
  theme: ResolvedTheme,
  root: HTMLElement | null = browserThemeRoot()
): void {
  if (root) {
    root.dataset.theme = theme;
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => loadThemePreference());
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme>(() => readSystemTheme());
  const resolvedTheme = resolveThemePreference(preference, systemTheme);

  useEffect(() => {
    const mediaQuery = browserSystemThemeQuery();
    if (!mediaQuery) {
      return;
    }

    const handleChange = (event: MediaQueryListEvent) => {
      setSystemTheme(resolvedThemeForSystemPreference(event.matches));
    };

    setSystemTheme(resolvedThemeForSystemPreference(mediaQuery.matches));
    if (typeof mediaQuery.addEventListener === 'function') {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }

    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  useEffect(() => {
    applyDocumentTheme(resolvedTheme);
  }, [resolvedTheme]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    saveThemePreference(nextPreference);
    setPreferenceState(nextPreference);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolvedTheme,
      setPreference
    }),
    [preference, resolvedTheme, setPreference]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return value;
}

function readSystemTheme(
  mediaQuery: MediaQueryList | null = browserSystemThemeQuery()
): ResolvedTheme {
  return resolvedThemeForSystemPreference(Boolean(mediaQuery?.matches));
}

function browserStorage(): ThemePreferenceStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function browserSystemThemeQuery(): MediaQueryList | null {
  try {
    return typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? null
      : window.matchMedia(systemThemeMediaQuery);
  } catch {
    return null;
  }
}

function browserThemeRoot(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.documentElement;
}
