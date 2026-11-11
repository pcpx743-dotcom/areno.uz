/** Light / dark theme. index.html sets data-theme before first paint; this keeps it in sync. */
import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';
const KEY = 'oqtepa.theme.v2';

const stored = (): Theme | null => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
};

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b0e13' : '#f4f5f9');
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? 'dark');
  useEffect(() => apply(theme), [theme]);
  const toggle = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* private mode: theme still switches for this visit */
      }
      return next;
    });
  }, []);
  return { theme, toggle };
}
