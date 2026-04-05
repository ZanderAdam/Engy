'use client';

import { createContext, useContext } from 'react';
import type { ActivityEvent, TerminalScope, TerminalStatus, SplitPosition, TerminalDropdownGroup } from './types';
import type { TerminalActions } from './terminal';

export interface TerminalDockContextValue {
  openTerminal: (scope?: TerminalScope, position?: SplitPosition) => void;
  handleStatusChange: (sessionId: string, status: TerminalStatus) => void;
  handleActivity: (sessionId: string, event: ActivityEvent) => void;
  handleReady: (sessionId: string, actions: TerminalActions | null) => void;
  renameTerminal: (sessionId: string, newLabel: string) => void;
  onCollapse: () => void;
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
  defaultScope?: TerminalScope;
}

export const TerminalDockContext = createContext<TerminalDockContextValue | null>(null);

export function useTerminalDock(): TerminalDockContextValue {
  const ctx = useContext(TerminalDockContext);
  if (!ctx) throw new Error('useTerminalDock must be used within TerminalDockContext');
  return ctx;
}
