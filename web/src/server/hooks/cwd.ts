import { WebSocket } from 'ws';
import type { TerminalCwdCmd } from '@engy/common';
import { persistTerminalSession } from '../ws/terminal-session-store';
import { isSubagentEvent } from './shared';
import type { HookHandler } from './types';

/** The directory a session's branch is tracked from: where the agent says it is, else its spawn cwd. */
export function resolveTrackedDir(meta: { workingDir: string; agentCwd?: string }): string {
  return meta.agentCwd ?? meta.workingDir;
}

/**
 * Follows the agent's working directory across a session. Hook payloads carry
 * no branch field — `cwd` is the only channel for it, and entering a worktree
 * is reported there while `CLAUDE_PROJECT_DIR` deliberately stays put. Without
 * this the branch subheader freezes at whatever `HEAD` the spawn directory
 * resolved to, since a worktree keeps its own `HEAD` under
 * `.git/worktrees/<name>/` that the original watch never sees.
 *
 * `agentCwd` is kept separate from `workingDir` rather than overwriting it:
 * `workingDir` is the session's spawn identity and a respawn must still land
 * where the terminal was opened, not wherever the agent wandered.
 *
 * Subagent events reuse the parent's `session_id` and report the subagent's own
 * cwd — an isolation worktree, typically — so they are ignored here, matching
 * every other session-level handler.
 */
export const handleCwdChange: HookHandler = (payload, meta, state, sessionId) => {
  if (isSubagentEvent(payload)) return;

  const cwd = payload.cwd;
  if (typeof cwd !== 'string' || !cwd || cwd === resolveTrackedDir(meta)) return;

  meta.agentCwd = cwd;
  persistTerminalSession(sessionId, meta);

  const daemon = state.terminalDaemon;
  if (!daemon || daemon.readyState !== WebSocket.OPEN) return;
  daemon.send(JSON.stringify({ t: 'cwd', sessionId, workingDir: cwd } satisfies TerminalCwdCmd));
};
