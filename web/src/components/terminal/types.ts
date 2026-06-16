import type { ElementType } from 'react';

export type TerminalScopeType = 'project' | 'workspace' | 'dir' | 'worktree';

export type TerminalStatus = 'connecting' | 'active' | 'exited' | 'error';

export type TerminalActivityState = 'idle' | 'active' | 'waiting' | 'done';

export type ActivityEvent = 'start' | 'idle' | 'waiting' | 'done';

export type ContainerMode = 'host' | 'container';

// Four-state activity model (after agent-deck / herdr): active = working,
// waiting = blocked on input (bell/prompt), done = finished but unseen,
// idle = acknowledged. `done` is a calm steady green vs `waiting`'s urgent
// bouncing amber, so "finished" no longer masquerades as "needs input".
export const TERMINAL_ACTIVITY_STYLES: Partial<Record<TerminalActivityState | TerminalStatus, string>> = {
  active: 'animate-pulse text-blue-500',
  waiting: 'animate-bounce text-amber-400',
  done: 'text-emerald-400',
  connecting: 'animate-pulse text-muted-foreground',
};

export function getTerminalIconStyle(tab: TerminalTab): string | undefined {
  if (tab.status === 'connecting') return TERMINAL_ACTIVITY_STYLES.connecting;
  if (tab.status === 'exited') return undefined;
  if (tab.activityState && tab.activityState !== 'idle') return TERMINAL_ACTIVITY_STYLES[tab.activityState];
  return undefined;
}

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
  /** Dynamic title from OSC 0/2 escape sequences, shown as subtitle under scopeLabel. */
  oscTitle?: string;
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
