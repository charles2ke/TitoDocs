import { createContext, use, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocalStorage } from './lib/util';

export type ThemeSetting = 'light' | 'dark' | 'system';

interface ThemeState {
  setting: ThemeSetting;
  resolved: 'light' | 'dark';
  setSetting(setting: ThemeSetting): void;
}

const ThemeContext = createContext<ThemeState | null>(null);
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [setting, setSettingState] = useLocalStorage<ThemeSetting>('theme', 'system');
  const [systemDark, setSystemDark] = useState(media.matches);

  useEffect(() => {
    const onChange = () => setSystemDark(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const resolved = setting === 'system' ? (systemDark ? 'dark' : 'light') : setting;
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setSetting = useCallback((next: ThemeSetting) => setSettingState(next), [setSettingState]);
  const value = useMemo(() => ({ setting, resolved, setSetting }), [setting, resolved, setSetting]);
  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme(): ThemeState {
  const value = use(ThemeContext);
  if (!value) throw new Error('useTheme must be used inside <ThemeProvider>');
  return value;
}
