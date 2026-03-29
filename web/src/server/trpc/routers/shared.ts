import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { getDb } from '../../db/client';
import { agentSessions } from '../../db/schema';

export const sessionIdParam = z.string().optional();

export function resolveRepoDir(repoDir: string, sessionId?: string): string {
  if (!sessionId) return repoDir;

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

  return session.worktreePath;
}
