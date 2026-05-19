'use client';

import { createContext, useContext } from 'react';

interface BottomTerminalContextValue {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

const Ctx = createContext<BottomTerminalContextValue | null>(null);

export const BottomTerminalProvider = Ctx.Provider;

export function useBottomTerminal(): BottomTerminalContextValue | null {
  return useContext(Ctx);
}
