import type { ElementType } from 'react';

export type TerminalScopeType = 'project' | 'workspace' | 'dir' | 'worktree';

export type TerminalStatus = 'connecting' | 'active' | 'exited' | 'error';

export type ContainerMode = 'host' | 'container';

export interface TerminalScope {
  scopeType: TerminalScopeType;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  groupKey: string;
  workspaceSlug: string;
  containerMode?: ContainerMode;
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

export function toContainerScope(scope: TerminalScope): TerminalScope {
  return {
    ...scope,
    containerMode: 'container',
    command: scope.command?.replace('--permission-mode acceptEdits', '--dangerously-skip-permissions'),
  };
}
