'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

// Mobile full-screen overlays (only one open at a time):
//   'files'    — the left files sidebar
//   'terminal' — the RIGHT terminal (Claude/agent), opened from the project's
//                mobile header or the workspace nav's terminal toggle
//   'shell'    — the BOTTOM terminal (plain shell), opened from the floating toggle
type MobileOverlay = 'files' | 'terminal' | 'shell' | null;

interface MobileOverlayContextValue {
  overlay: MobileOverlay;
  openOverlay: (kind: Exclude<MobileOverlay, null>) => void;
  closeOverlay: () => void;
  // Measured height of the mobile header's identity bar (0 when absent), so
  // full-screen overlays sit below it — only workspace/project/tab switching
  // stays visible above them. Scoped per provider — i.e. per open tab — so
  // background tabs (rendered but hidden) can't clobber the active tab's value.
  headerHeight: number;
  setHeaderHeight: (height: number) => void;
}

const Ctx = createContext<MobileOverlayContextValue | null>(null);

export function MobileOverlayProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = useState<MobileOverlay>(null);
  const [headerHeight, setHeaderHeight] = useState(0);

  const openOverlay = useCallback((kind: Exclude<MobileOverlay, null>) => {
    setOverlay(kind);
  }, []);

  const closeOverlay = useCallback(() => {
    setOverlay(null);
  }, []);

  const value = useMemo(
    () => ({ overlay, openOverlay, closeOverlay, headerHeight, setHeaderHeight }),
    [overlay, openOverlay, closeOverlay, headerHeight],
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
