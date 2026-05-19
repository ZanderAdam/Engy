'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type MobileOverlay = 'files' | 'terminal' | 'comments' | null;

interface MobileOverlayContextValue {
  overlay: MobileOverlay;
  openOverlay: (kind: Exclude<MobileOverlay, null>) => void;
  closeOverlay: () => void;
}

const Ctx = createContext<MobileOverlayContextValue | null>(null);

export function MobileOverlayProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = useState<MobileOverlay>(null);

  const openOverlay = useCallback((kind: Exclude<MobileOverlay, null>) => {
    setOverlay(kind);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  const value = useMemo(
    () => ({ overlay, openOverlay, closeOverlay }),
    [overlay, openOverlay, closeOverlay],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMobileOverlay(): MobileOverlayContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error('useMobileOverlay must be used within MobileOverlayProvider');
  }
  return ctx;
}

export function useOptionalMobileOverlay(): MobileOverlayContextValue | null {
  return useContext(Ctx);
}
