import { WebSocket } from 'ws';
import type { AppState } from '../trpc/context';

interface TerminalSessionListItem {
  sessionId: string;
  scopeType: string;
  scopeLabel: string;
  workingDir: string;
  command?: string;
  agentType?: string;
  groupKey?: string;
  workspaceSlug?: string;
  projectSlug?: string;
  taskId?: number;
  worktreeBranch?: string;
  renamedLabel?: string;
  lastTitle?: string;
  needsAttention: boolean;
  activityState: string;
  status: 'active' | 'suspended';
  browserCount: number;
  /** PTY lost on a daemon restart — the tab is restorable, not live. */
  dormant: boolean;
  activeSubagents: number;
  lastFailure?: { type: string; message: string; at: number };
  /** Worktrees a CLI created inside this session, distinct from runner-managed ones. */
  cliWorktrees: string[];
  /**
   * FR-TERMINAL-800: seeds the tab's server-owned override at initial page
   * load. Without this, a freshly loaded tab for an already-hook-driven
   * session has `hookDriven === undefined` until the next hook event fires,
   * reintroducing the local-PTY-heuristic race the override exists to
   * prevent, once per page load.
   */
  hookDriven: boolean;
}

interface TerminalSessionListQuery {
  /** Global mode — return every session regardless of scope (command center). */
  all: boolean;
  groupKey: string | null;
  scopeType: string;
  scopeLabel: string;
}

function openBrowserCount(wsSet: Set<WebSocket> | undefined): number {
  if (!wsSet) return 0;
  let count = 0;
  for (const w of wsSet) {
    if (w.readyState === WebSocket.OPEN) count++;
  }
  return count;
}

/**
 * Build the terminal session list for `GET /api/terminal/sessions`. In `all`
 * mode every persisted session is returned (the command center's global view);
 * otherwise sessions are filtered by `groupKey`, falling back to a
 * scopeType+scopeLabel match. Each item carries the project/worktree identity
 * and daemon-tracked `activityState` the command center groups and renders.
 */
export function listTerminalSessions(
  state: Pick<AppState, 'terminalSessionMeta' | 'terminalSessions'>,
  query: TerminalSessionListQuery,
): TerminalSessionListItem[] {
  return Array.from(state.terminalSessionMeta.entries())
    .filter(([, m]) => {
      if (query.all) return true;
      if (query.groupKey != null) return m.groupKey === query.groupKey;
      return m.scopeType === query.scopeType && m.scopeLabel === query.scopeLabel;
    })
    .map(([sessionId, m]) => {
      const browserCount = openBrowserCount(state.terminalSessions.get(sessionId));
      return {
        sessionId,
        scopeType: m.scopeType,
        scopeLabel: m.scopeLabel,
        workingDir: m.workingDir,
        command: m.command,
        agentType: m.agentType,
        groupKey: m.groupKey,
        workspaceSlug: m.workspaceSlug,
        projectSlug: m.projectSlug,
        taskId: m.taskId,
        worktreeBranch: m.worktreeBranch,
        renamedLabel: m.renamedLabel,
        lastTitle: m.lastTitle,
        needsAttention: m.needsAttention === true,
        activityState: m.activityState ?? 'idle',
        status: browserCount > 0 ? ('active' as const) : ('suspended' as const),
        browserCount,
        dormant: m.dormant === true,
        activeSubagents: m.activeSubagents ?? 0,
        lastFailure: m.lastFailure,
        cliWorktrees: m.cliWorktrees ?? [],
        hookDriven: m.hookDriven === true,
      };
    });
}
