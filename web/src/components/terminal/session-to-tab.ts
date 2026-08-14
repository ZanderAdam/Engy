import { isAgentTypeId, type AgentTypeId } from '@/lib/agent-types';
import type { TerminalActivityState, TerminalScope, TerminalTab } from './types';

/** One entry of `GET /api/terminal/sessions` (see terminal-session-list.ts). */
export interface SessionListItem {
  sessionId: string;
  scopeType: TerminalScope['scopeType'];
  scopeLabel: string;
  workingDir: string;
  command?: string;
  agentType?: string;
  groupKey?: string;
  workspaceSlug?: string;
  projectSlug?: string;
  taskId?: number;
  worktreeBranch?: string;
  activityState?: TerminalActivityState;
  status: 'active' | 'suspended';
  browserCount: number;
  dormant?: boolean;
}

/**
 * Rebuild a dock tab from a listed session. A dormant session (its PTY died
 * with the daemon while nobody was attached) becomes a tab that opens no
 * socket until the user restores it.
 */
export function sessionToTab(s: SessionListItem, fallbackGroupKey: string): TerminalTab {
  return {
    sessionId: s.sessionId,
    scope: {
      scopeType: s.scopeType,
      scopeLabel: s.scopeLabel,
      workingDir: s.workingDir,
      command: s.command,
      agentType: isAgentTypeId(s.agentType ?? '') ? (s.agentType as AgentTypeId) : undefined,
      groupKey: s.groupKey ?? fallbackGroupKey,
      workspaceSlug: s.workspaceSlug ?? '',
      projectSlug: s.projectSlug,
      taskId: s.taskId,
      worktreeBranch: s.worktreeBranch,
    },
    status: s.dormant ? 'dormant' : 'connecting',
    // Seed the daemon-tracked activity so the dot is correct on first paint,
    // before this session's WebSocket delivers its first live update.
    activityState: s.activityState ?? 'idle',
  };
}
