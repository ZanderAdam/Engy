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

// Filled-box variant for the rail dots, where colouring the whole box (not just
// the icon stroke) makes the activity state legible at small size.
const TERMINAL_ACTIVITY_BOX_STYLES: Record<TerminalActivityState, string> = {
  idle: 'bg-muted text-muted-foreground',
  active: 'bg-blue-500 text-white animate-pulse',
  waiting: 'bg-amber-400 text-black animate-pulse',
  done: 'bg-emerald-500 text-white',
};

export function getTerminalRailBoxStyle(tab: TerminalTab): string {
  if (tab.status === 'connecting') return 'bg-muted text-muted-foreground animate-pulse';
  if (tab.status === 'error') return 'bg-destructive/25 text-destructive';
  if (tab.status === 'exited') return 'bg-muted/40 text-muted-foreground';
  return TERMINAL_ACTIVITY_BOX_STYLES[tab.activityState ?? 'idle'];
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
  // Project identity for per-project activity rollup (badges). Only set for
  // project/worktree scopes; workspace/dir scopes don't roll up to a project.
  projectId?: number;
  projectSlug?: string;
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
