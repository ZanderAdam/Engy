import { persistTerminalSession } from '../ws/terminal-session-store';
import type { HookHandler, HookPayload } from './types';

// No live WorktreeCreate/WorktreeRemove payload was captured during TG1's
// probe, so the field carrying the path is unconfirmed. Checked in order of
// plausibility (a named `worktree_path`, a generic `path`, the hook's `cwd`)
// rather than guessed; an event carrying none of them is ignored.
function readWorktreePath(payload: HookPayload): string | undefined {
  const candidates = [payload.worktree_path, payload.path, payload.cwd];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate) return candidate;
  }
  return undefined;
}

// Always returns void — never a HookResult — so a WorktreeCreate is never
// held up: the hook aborts creation on any non-zero exit, and Engy has no
// basis to veto a worktree the user asked for (FR-GIT-370).
export const handleWorktreeCreate: HookHandler = (payload, meta, _state, sessionId) => {
  const worktreePath = readWorktreePath(payload);
  if (!worktreePath) return;

  const list = meta.cliWorktrees ?? (meta.cliWorktrees = []);
  if (!list.includes(worktreePath)) list.push(worktreePath);
  persistTerminalSession(sessionId, meta);
};

export const handleWorktreeRemove: HookHandler = (payload, meta, _state, sessionId) => {
  const worktreePath = readWorktreePath(payload);
  if (!worktreePath || !meta.cliWorktrees?.length) return;
  const index = meta.cliWorktrees.indexOf(worktreePath);
  if (index === -1) return;

  meta.cliWorktrees.splice(index, 1);
  persistTerminalSession(sessionId, meta);
};
