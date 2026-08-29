import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { terminalSessions as terminalSessionsTable } from '../db/schema';
import type { AppState, TerminalSessionMeta } from '../trpc/context';

/**
 * SQLite mirror of the in-memory `terminalSessionMeta` map, so terminal
 * sessions survive a server restart while their PTYs stay alive on the daemon.
 * Persistence is best-effort: the terminal relay must keep working when the
 * DB is unavailable, so every operation swallows and logs failures.
 */

export function persistTerminalSession(sessionId: string, meta: TerminalSessionMeta): void {
  try {
    const db = getDb();
    const metaRecord = meta as unknown as Record<string, unknown>;
    const updatedAt = new Date().toISOString();
    db.insert(terminalSessionsTable)
      .values({ sessionId, meta: metaRecord, updatedAt })
      .onConflictDoUpdate({
        target: terminalSessionsTable.sessionId,
        set: { meta: metaRecord, updatedAt },
      })
      .run();
  } catch (err) {
    console.warn(`[terminal] Failed to persist session ${sessionId}:`, err);
  }
}

export function deletePersistedTerminalSession(sessionId: string): void {
  try {
    const db = getDb();
    db.delete(terminalSessionsTable).where(eq(terminalSessionsTable.sessionId, sessionId)).run();
  } catch (err) {
    console.warn(`[terminal] Failed to delete persisted session ${sessionId}:`, err);
  }
}

function isValidMeta(value: unknown): value is TerminalSessionMeta {
  if (value === null || typeof value !== 'object') return false;
  const meta = value as Record<string, unknown>;
  return (
    typeof meta.scopeType === 'string' &&
    typeof meta.scopeLabel === 'string' &&
    typeof meta.workingDir === 'string' &&
    typeof meta.cols === 'number' &&
    typeof meta.rows === 'number'
  );
}

/**
 * Restore persisted sessions into `state.terminalSessionMeta` at server boot,
 * marking them in `state.restoredTerminalSessions` so browser connects hold
 * classification until the daemon's next `{ t: 'sync' }` validates them: the
 * sync handler purges entries (and their rows) the daemon no longer has.
 */
export function loadPersistedTerminalSessions(state: AppState): void {
  try {
    const db = getDb();
    const rows = db.select().from(terminalSessionsTable).all();
    let restored = 0;
    for (const row of rows) {
      if (!isValidMeta(row.meta)) {
        console.warn(`[terminal] Skipping malformed persisted session ${row.sessionId}`);
        continue;
      }
      if (!state.terminalSessionMeta.has(row.sessionId)) {
        // The live subagent id set (hooks/subagent.ts) is process-only and does
        // not survive a restart, so a persisted count has nothing backing it —
        // reset it rather than let it desync from the next SubagentStop, which
        // recomputes from an empty set and would otherwise floor a stale count
        // to 0 instead of decrementing it.
        row.meta.activeSubagents = undefined;
        state.terminalSessionMeta.set(row.sessionId, row.meta);
        state.restoredTerminalSessions.add(row.sessionId);
        restored++;
      }
    }
    if (restored > 0) {
      console.log(`[terminal] Restored ${restored} persisted terminal session(s)`);
    }
  } catch (err) {
    console.warn('[terminal] Failed to load persisted terminal sessions:', err);
  }
}
