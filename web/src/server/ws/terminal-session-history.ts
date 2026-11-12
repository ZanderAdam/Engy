import { eq, notInArray, desc, and, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { taskSessions, terminalSessionHistory } from '../db/schema';
import type { AppState, TerminalSessionMeta } from '../trpc/context';

interface SessionHistoryRow {
  sessionId: string;
  agentType: string;
  workingDir: string;
  scopeLabel: string;
  summary: string;
  workspaceSlug: string | null;
  projectSlug: string | null;
  worktreeBranch: string | null;
  containerMode: string | null;
  startedAt: string;
  closedAt: string | null;
}

// Caps rows per workspace bucket (null slug = its own bucket). Sessions linked
// to a task are exempt: a task must keep every session it can resume.
const MAX_HISTORY_ROWS = 50;

export function terminalSessionKey(
  terminalSessionId: string,
  meta: Pick<TerminalSessionMeta, 'resumedFrom'> | undefined,
): string {
  return meta?.resumedFrom ?? terminalSessionId;
}

export function recordSessionStart(terminalSessionId: string, meta: TerminalSessionMeta): void {
  if (!meta.agentType) return;
  try {
    const db = getDb();
    // Key by the agent-CLI conversation id so resume cycles share one row —
    // the terminal id is only the key for first-run sessions.
    const key = terminalSessionKey(terminalSessionId, meta);
    const now = new Date().toISOString();
    db.insert(terminalSessionHistory)
      .values({
        sessionId: key,
        agentType: meta.agentType,
        workingDir: meta.workingDir,
        scopeLabel: meta.scopeLabel,
        summary: meta.scopeLabel,
        workspaceSlug: meta.workspaceSlug ?? null,
        projectSlug: meta.projectSlug ?? null,
        worktreeBranch: meta.worktreeBranch ?? null,
        containerMode: meta.containerMode ?? null,
        startedAt: now,
        closedAt: null,
      })
      .onConflictDoUpdate({
        target: terminalSessionHistory.sessionId,
        set: {
          agentType: meta.agentType,
          workingDir: meta.workingDir,
          scopeLabel: meta.scopeLabel,
          workspaceSlug: meta.workspaceSlug ?? null,
          projectSlug: meta.projectSlug ?? null,
          worktreeBranch: meta.worktreeBranch ?? null,
          containerMode: meta.containerMode ?? null,
          startedAt: now,
          closedAt: null,
          // summary intentionally not overwritten — preserve accumulated title
        },
      })
      .run();

    pruneHistoryBucket(meta.workspaceSlug ?? null);
  } catch (err) {
    console.warn(`[terminal-history] Failed to record session start ${terminalSessionId}:`, err);
  }
}

export function updateSessionSummary(key: string, summary: string): void {
  try {
    const db = getDb();
    db.update(terminalSessionHistory)
      .set({ summary })
      .where(eq(terminalSessionHistory.sessionId, key))
      .run();
  } catch (err) {
    console.warn(`[terminal-history] Failed to update summary for ${key}:`, err);
  }
}

export function markSessionClosed(key: string): void {
  try {
    const db = getDb();
    db.update(terminalSessionHistory)
      .set({ closedAt: new Date().toISOString() })
      .where(eq(terminalSessionHistory.sessionId, key))
      .run();
  } catch (err) {
    console.warn(`[terminal-history] Failed to mark session closed ${key}:`, err);
  }
}

/**
 * Looks up a session's workspace after its live `terminalSessionMeta` may
 * already be gone (e.g. a `SessionEnd` hook's PTY exits almost immediately,
 * while the memory-capture job it launched keeps running for seconds after).
 * Direct-match only: a resumed session's row is keyed by its agent-CLI
 * conversation id (`meta.resumedFrom` in `recordSessionStart`), not the
 * terminal session id, so this resolves first-run sessions only.
 */
export function getHistoryWorkspaceSlug(sessionId: string): string | null {
  return getHistoryRow(sessionId)?.workspaceSlug ?? null;
}

export function getHistoryRow(sessionId: string): SessionHistoryRow | null {
  try {
    return (
      getDb()
        .select()
        .from(terminalSessionHistory)
        .where(eq(terminalSessionHistory.sessionId, sessionId))
        .get() ?? null
    );
  } catch (err) {
    console.warn(`[terminal-history] Failed to read history for session ${sessionId}:`, err);
    return null;
  }
}

export function liveHistoryKeys(state: Pick<AppState, 'terminalSessionMeta'>): Set<string> {
  const keys = new Set<string>();
  for (const [sessionId, meta] of state.terminalSessionMeta) {
    keys.add(terminalSessionKey(sessionId, meta));
  }
  return keys;
}

/**
 * Resumable history for a workspace, newest first. `projectSlug` narrows the
 * list to one project's sessions — a project's terminal dropdown offers what
 * ran in that project, not every session in the workspace.
 */
export function listSessionHistory(
  workspaceSlug: string,
  liveKeys: ReadonlySet<string>,
  projectSlug?: string,
): SessionHistoryRow[] {
  try {
    const db = getDb();
    const liveArr = [...liveKeys];
    const condition = and(
      eq(terminalSessionHistory.workspaceSlug, workspaceSlug),
      projectSlug ? eq(terminalSessionHistory.projectSlug, projectSlug) : undefined,
      liveArr.length > 0 ? notInArray(terminalSessionHistory.sessionId, liveArr) : undefined,
    );
    return db
      .select()
      .from(terminalSessionHistory)
      .where(condition)
      .orderBy(desc(terminalSessionHistory.startedAt))
      .all();
  } catch (err) {
    console.warn(`[terminal-history] Failed to list history for workspace ${workspaceSlug}:`, err);
    return [];
  }
}

function pruneHistoryBucket(workspaceSlug: string | null): void {
  try {
    const db = getDb();
    const bucketCondition = and(
      workspaceSlug === null
        ? isNull(terminalSessionHistory.workspaceSlug)
        : eq(terminalSessionHistory.workspaceSlug, workspaceSlug),
      notInArray(
        terminalSessionHistory.sessionId,
        db.select({ sessionKey: taskSessions.sessionKey }).from(taskSessions),
      ),
    );

    const rows = db
      .select({ sessionId: terminalSessionHistory.sessionId })
      .from(terminalSessionHistory)
      .where(bucketCondition)
      .orderBy(desc(terminalSessionHistory.startedAt))
      .all();

    if (rows.length <= MAX_HISTORY_ROWS) return;

    const keepIds = rows.slice(0, MAX_HISTORY_ROWS).map((r) => r.sessionId);
    db.delete(terminalSessionHistory)
      .where(and(bucketCondition, notInArray(terminalSessionHistory.sessionId, keepIds)))
      .run();
  } catch (err) {
    console.warn(`[terminal-history] Failed to prune history bucket:`, err);
  }
}
