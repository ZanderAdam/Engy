import type { TerminalActivityState, TerminalScope, TerminalTab } from '../types';

/**
 * One active terminal as returned by GET /api/terminal/sessions?all=1 — the
 * global, cross-project list the command center renders. Mirrors the server's
 * session-list shape (web/server.ts), carrying the project/worktree identity
 * needed to group sessions and the live activity/status used for the dots.
 */
export interface CommandCenterSession {
  sessionId: string;
  scopeType: TerminalScope['scopeType'];
  scopeLabel: string;
  workingDir: string;
  command?: string;
  groupKey?: string;
  workspaceSlug?: string;
  projectSlug?: string;
  taskId?: number;
  worktreeBranch?: string;
  activityState: TerminalActivityState;
  status: 'active' | 'suspended';
}

/**
 * Convert a global session into the TerminalTab shape the rail/list renderers
 * and the live TerminalInstance consume. Mapped to `status: 'active'` because
 * every listed session is alive on the server (suspended only means no browser
 * is attached); this lets the list dot follow the daemon-tracked activityState
 * rather than rendering a perpetual "connecting" pulse.
 */
export function commandCenterSessionToTab(s: CommandCenterSession): TerminalTab {
  return {
    sessionId: s.sessionId,
    scope: {
      scopeType: s.scopeType,
      scopeLabel: s.scopeLabel,
      workingDir: s.workingDir,
      command: s.command,
      groupKey: s.groupKey ?? '',
      workspaceSlug: s.workspaceSlug ?? '',
      projectSlug: s.projectSlug,
      taskId: s.taskId,
      worktreeBranch: s.worktreeBranch,
    },
    status: 'active',
    activityState: s.activityState,
  };
}
