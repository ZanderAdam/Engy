import type { ElementType } from 'react';

export type TerminalScopeType = 'project' | 'workspace' | 'dir';

export type TerminalStatus = 'connecting' | 'active' | 'exited' | 'error';

export interface TerminalScope {
  scopeType: TerminalScopeType;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  groupKey: string;
  workspaceSlug?: string;
}

export interface TerminalTab {
  sessionId: string;
  scope: TerminalScope;
  status: TerminalStatus;
}

export interface TerminalPanelParams {
  tab: TerminalTab;
}

export interface SplitPosition {
  referencePanel: string;
  direction: 'right' | 'below';
}

export interface TerminalDropdownEntry {
  id: string;
  label: string;
  tooltip?: string;
  scope: TerminalScope;
  icon?: ElementType;
}

export interface TerminalDropdownGroup {
  label?: string;
  entries: TerminalDropdownEntry[];
}
