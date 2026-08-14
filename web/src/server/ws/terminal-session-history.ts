import { eq, notInArray, desc, and, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { terminalSessionHistory } from '../db/schema';
import type { TerminalSessionMeta } from '../trpc/context';

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

// Caps rows per workspace bucket (null slug = its own bucket).
const MAX_HISTORY_ROWS = 50;

export function recordSessionStart(terminalSessionId: string, meta: TerminalSessionMeta): void {
  if (!meta.agentType) return;
  try {
    const db = getDb();
    // Key by the agent-CLI conversation id so resume cycles share one row —
    // the terminal id is only the key for first-run sessions.
    const key = meta.resumedFrom ?? terminalSessionId;
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
    const bucketCondition =
      workspaceSlug === null
        ? isNull(terminalSessionHistory.workspaceSlug)
        : eq(terminalSessionHistory.workspaceSlug, workspaceSlug);

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
