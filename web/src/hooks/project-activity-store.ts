import type { TerminalActivityState } from '@engy/common';

export interface ProjectActivityCounts {
  active: number;
  waiting: number;
  done: number;
}

export interface ActivitySnapshot {
  sessionId: string;
  workspaceSlug?: string;
  projectSlug?: string;
  state: TerminalActivityState;
}

export const EMPTY_COUNTS: ProjectActivityCounts = { active: 0, waiting: 0, done: 0 };

// Project slugs repeat across workspaces (every workspace has `default`).
function projectKey(workspaceSlug: string, projectSlug: string): string {
  return `${workspaceSlug}/${projectSlug}`;
}

// Daemon-computed terminal activity, keyed by session, rolled up per project.
// Module-level so every badge shares one store; driven by useProjectActivityFeed.
const bySession = new Map<string, { projectKey: string; state: TerminalActivityState }>();
const listeners = new Set<() => void>();
let rollup = new Map<string, ProjectActivityCounts>();

function recompute() {
  const next = new Map<string, ProjectActivityCounts>();
  for (const { projectKey: key, state } of bySession.values()) {
    if (state === 'idle') continue;
    const c = next.get(key) ?? { ...EMPTY_COUNTS };
    if (state === 'active') c.active++;
    else if (state === 'waiting') c.waiting++;
    else if (state === 'done') c.done++;
    next.set(key, c);
  }
  rollup = next;
  for (const l of listeners) l();
}

/** Replace the full session set from a snapshot — heals any deltas missed
 * while the events socket was disconnected, including removals. */
export function seed(sessions: ActivitySnapshot[]): void {
  bySession.clear();
  for (const s of sessions) {
    if (s.workspaceSlug && s.projectSlug) {
      bySession.set(s.sessionId, {
        projectKey: projectKey(s.workspaceSlug, s.projectSlug),
        state: s.state,
      });
    }
  }
  recompute();
}

export function apply(
  sessionId: string,
  workspaceSlug: string,
  projectSlug: string,
  state: TerminalActivityState,
): void {
  bySession.set(sessionId, { projectKey: projectKey(workspaceSlug, projectSlug), state });
  recompute();
}

export function remove(sessionId: string): void {
  if (bySession.delete(sessionId)) recompute();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProjectCounts(
  workspaceSlug: string,
  projectSlug: string,
): ProjectActivityCounts {
  return rollup.get(projectKey(workspaceSlug, projectSlug)) ?? EMPTY_COUNTS;
}
