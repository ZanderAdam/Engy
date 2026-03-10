'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useCallback,
  type ReactNode,
} from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';

type ThemeFlavor = 'default' | 'cyberpunk';

interface ThemeFlavorContextValue {
  flavor: ThemeFlavor;
  setFlavor: (flavor: ThemeFlavor) => void;
}

const ThemeFlavorContext = createContext<ThemeFlavorContextValue>({
  flavor: 'default',
  setFlavor: () => {},
});

const FLAVOR_STORAGE_KEY = 'engy-theme-flavor';

function ThemeFlavorProvider({ children }: { children: ReactNode }) {
  const [flavor, setFlavorState] = useState<ThemeFlavor>('default');
  const { resolvedTheme, setTheme } = useTheme();
  const previousThemeRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(FLAVOR_STORAGE_KEY);
    if (stored === 'cyberpunk') {
      setFlavorState('cyberpunk');
    }
  }, []);

  useEffect(() => {
    const html = document.documentElement;
    if (flavor === 'cyberpunk') {
      previousThemeRef.current = resolvedTheme ?? 'dark';
      html.classList.add('theme-cyberpunk');
      setTheme('dark');
    } else {
      html.classList.remove('theme-cyberpunk');
      if (previousThemeRef.current) {
        setTheme(previousThemeRef.current);
        previousThemeRef.current = null;
      }
    }
    // resolvedTheme intentionally excluded — we read it but must not re-run on its changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flavor, setTheme]);

  const setFlavor = useCallback(
    (newFlavor: ThemeFlavor) => {
      setFlavorState(newFlavor);
      localStorage.setItem(FLAVOR_STORAGE_KEY, newFlavor);
    },
    [],
  );

  return (
    <ThemeFlavorContext.Provider value={{ flavor, setFlavor }}>
      {children}
    </ThemeFlavorContext.Provider>
  );
}

export function useThemeFlavor() {
  return useContext(ThemeFlavorContext);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      <ThemeFlavorProvider>{children}</ThemeFlavorProvider>
    </NextThemesProvider>
  );
}
