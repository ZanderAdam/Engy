import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../../db/client';
import { agentSessions } from '../../db/schema';

/**
 * Resolve the code roots for a trace/validateWorkspace call.
 *
 * If a sessionId is provided, looks up the agent session and returns the
 * session's worktreePath as the sole root (overriding ws.repos). This lets a
 * calling agent scope the trace to its own worktree rather than the main
 * checkout.
 *
 * Returns undefined when no sessionId is given — callers fall back to ws.repos.
 */
export function resolveWorktreeRoots(sessionId?: string): string[] | undefined {
  if (!sessionId) return undefined;

  const db = getDb();
  const session = db
    .select()
    .from(agentSessions)
    .where(eq(agentSessions.sessionId, sessionId))
    .get();

  if (!session) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Session "${sessionId}" not found`,
    });
  }

  if (!session.worktreePath) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Session "${sessionId}" has no worktree path`,
    });
  }

  return [session.worktreePath];
}
