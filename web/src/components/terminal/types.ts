import type { ElementType } from 'react';

export type TerminalScopeType = 'project' | 'workspace' | 'dir' | 'worktree';

export type TerminalStatus = 'connecting' | 'active' | 'exited' | 'error';

export type TerminalActivityState = 'idle' | 'active' | 'waiting';

export type ActivityEvent = 'start' | 'idle' | 'waiting';

export type ContainerMode = 'host' | 'container';

export const TERMINAL_ACTIVITY_STYLES: Partial<Record<TerminalActivityState | TerminalStatus, string>> = {
  active: 'animate-pulse text-blue-500',
  waiting: 'animate-bounce text-amber-400',
  connecting: 'animate-pulse text-muted-foreground',
};

export interface TerminalScope {
  scopeType: TerminalScopeType;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  groupKey: string;
  workspaceSlug: string;
  containerMode?: ContainerMode;
  taskId?: number;
}

export interface TerminalTab {
  sessionId: string;
  scope: TerminalScope;
  status: TerminalStatus;
  activityState?: TerminalActivityState;
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
