import type { ElementType } from 'react';
import {
  buildAgentCommand,
  getAgentType,
  getMcpUrl,
  type AgentTypeId,
  type WorkspaceAgentSettings,
} from '@/lib/agent-types';

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
  // Which agent CLI this terminal runs (undefined = plain shell when command
  // is unset, claude otherwise). Recorded in session meta for the worker
  // picker and dispatch paste behavior.
  agentType?: AgentTypeId;
  // Ingredients the command was built from, kept so the command can be
  // rebuilt for a different agent type or container mode (see scopeForAgent /
  // toContainerScope) without string surgery on the command itself.
  // agentSettings carries the workspace's per-agent overrides so a rebuild
  // for a DIFFERENT agent picks up that agent's configured mode.
  agentContext?: {
    systemPrompt?: string;
    additionalDirs?: string[];
    agentSettings?: WorkspaceAgentSettings | null;
  };
  // Project identity for per-project activity rollup (badges). Only set for
  // project/worktree scopes; workspace/dir scopes don't roll up to a project.
  projectId?: number;
  projectSlug?: string;
  // Worktree branch this terminal targets (undefined = default branch). Used to
  // group terminals by worktree in combined mode; does not affect groupKey.
  worktreeBranch?: string;
  // Agent-CLI session id this terminal resumes (`claude --resume <id>`). Sent
  // to the server so history keeps tracking the original conversation instead
  // of forking a new row per resume.
  resumedFrom?: string;
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
  // A leaf entry carries a `scope` (clicking opens that terminal). A branch
  // entry carries `children` and renders as a submenu (e.g. a repo with its
  // worktrees). Exactly one of the two is set.
  scope?: TerminalScope;
  children?: TerminalDropdownEntry[];
  icon?: ElementType;
}

export interface TerminalDropdownGroup {
  label?: string;
  entries: TerminalDropdownEntry[];
}

export function toContainerScope(scope: TerminalScope): TerminalScope {
  const command = scope.agentContext
    ? buildAgentCommand(scope.agentType, {
        ...scope.agentContext,
        dangerouslySkipPermissions: true,
        mcpUrl: getMcpUrl(),
      })
    : scope.command
        ?.replace(/--permission-mode \S+/, '--dangerously-skip-permissions')
        ?.replace(
          /--sandbox \S+( --ask-for-approval \S+)?/,
          '--dangerously-bypass-approvals-and-sandbox',
        );
  return {
    ...scope,
    containerMode: 'container',
    command,
  };
}

// Rebuild a scope's command for a different agent CLI from the recorded
// ingredients. Sessions share the original groupKey (they belong to the same
// project group); the label is prefixed so tabs are distinguishable.
export function scopeForAgent(scope: TerminalScope, agentType: AgentTypeId): TerminalScope {
  if (agentType === (scope.agentType ?? 'claude')) return scope;
  return {
    ...scope,
    agentType,
    scopeLabel: `${getAgentType(agentType).label.toLowerCase()}: ${scope.scopeLabel}`,
    // agentContext is set on every scope built by deriveScope / layout.tsx; an
    // externally constructed scope without it rebuilds a bare command (no
    // system prompt, dirs, or per-agent mode).
    command: buildAgentCommand(agentType, {
      ...(scope.agentContext ?? {}),
      dangerouslySkipPermissions: scope.containerMode === 'container',
      mcpUrl: getMcpUrl(),
    }),
  };
}
