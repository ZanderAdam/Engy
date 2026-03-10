'use client';

import { createContext, useContext } from 'react';
import type { TerminalScope, TerminalStatus, SplitPosition } from './types';
import type { TerminalActions } from './terminal';

export interface TerminalDockContextValue {
  openTerminal: (scope?: TerminalScope, position?: SplitPosition) => void;
  handleStatusChange: (sessionId: string, status: TerminalStatus) => void;
  handleReady: (sessionId: string, actions: TerminalActions | null) => void;
  onCollapse: () => void;
}

export const TerminalDockContext = createContext<TerminalDockContextValue | null>(null);

export function useTerminalDock(): TerminalDockContextValue {
  const ctx = useContext(TerminalDockContext);
  if (!ctx) throw new Error('useTerminalDock must be used within TerminalDockContext');
  return ctx;
}
