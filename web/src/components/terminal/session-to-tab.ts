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
  renamedLabel?: string;
  lastTitle?: string;
  needsAttention?: boolean;
  activityState?: TerminalActivityState;
  status: 'active' | 'suspended';
  browserCount: number;
  dormant?: boolean;
  hookDriven?: boolean;
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
      renamedLabel: s.renamedLabel,
    },
    status: s.dormant ? 'dormant' : 'connecting',
    // Seed the daemon-tracked activity so the dot is correct on first paint,
    // before this session's WebSocket delivers its first live update.
    activityState: s.activityState ?? 'idle',
    // Seeds the subtitle for a session no browser has ever attached to —
    // otherwise a hook-derived title never reaches a tab built from this list.
    oscTitle: s.lastTitle,
    needsAttention: s.needsAttention,
    // FR-TERMINAL-800: seeds the server-owned override at initial load, so
    // the local PTY heuristic is suppressed immediately for an
    // already-hook-driven session instead of racing it until the next hook
    // event's TERMINAL_ACTIVITY_CHANGE broadcast arrives.
    hookDriven: s.hookDriven,
  };
}
