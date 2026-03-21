import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  dispatchGitStatus,
  dispatchGitDiff,
  dispatchGitLog,
  dispatchGitShow,
  dispatchGitBranchFiles,
} from '../../ws/server';
import { getDb } from '../../db/client';
import { agentSessions, tasks, taskGroups } from '../../db/schema';

/**
 * Resolves the effective repo directory. When a sessionId is provided,
 * looks up the session's worktreePath and uses it instead.
 */
function resolveRepoDir(repoDir: string, sessionId?: string): string {
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

const sessionIdParam = z.string().optional();

export const diffRouter = router({
  getStatus: publicProcedure
    .input(z.object({ repoDir: z.string().min(1), sessionId: sessionIdParam }))
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      return dispatchGitStatus(dir, ctx.state);
    }),

  getFileDiff: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        filePath: z.string().min(1),
        base: z.string().optional(),
        staged: z.boolean().optional(),
        sessionId: sessionIdParam,
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      const diff = await dispatchGitDiff(dir, input.filePath, ctx.state, input.base, input.staged);
      return { diff };
    }),

  getLog: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        maxCount: z.number().min(1).max(200).optional(),
        sessionId: sessionIdParam,
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      return dispatchGitLog(dir, ctx.state, input.maxCount);
    }),

  getCommitDiff: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        commitHash: z.string().min(1),
        sessionId: sessionIdParam,
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      return dispatchGitShow(dir, input.commitHash, ctx.state);
    }),

  getBranchDiff: publicProcedure
    .input(
      z.object({
        repoDir: z.string().min(1),
        base: z.string().min(1),
        sessionId: sessionIdParam,
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      try {
        const { files } = await dispatchGitBranchFiles(dir, input.base, ctx.state);
        return { files: files.map((f) => ({ ...f, staged: false })) };
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid base ref "${input.base}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  getSessions: publicProcedure
    .input(z.object({ projectId: z.number().optional() }))
    .query(({ input }) => {
      const db = getDb();
      const allSessions = db.select().from(agentSessions).all();

      const sessionsWithContext = allSessions.map((session) => {
        let taskTitle: string | null = null;
        let groupName: string | null = null;

        if (session.taskId) {
          const task = db.select().from(tasks).where(eq(tasks.id, session.taskId)).get();
          taskTitle = task?.title ?? null;
        }
        if (session.taskGroupId) {
          const group = db
            .select()
            .from(taskGroups)
            .where(eq(taskGroups.id, session.taskGroupId))
            .get();
          groupName = group?.name ?? null;
        }

        return {
          ...session,
          taskTitle,
          groupName,
        };
      });

      if (!input.projectId) return sessionsWithContext;

      const projectTaskIds = new Set(
        db
          .select({ id: tasks.id })
          .from(tasks)
          .where(eq(tasks.projectId, input.projectId))
          .all()
          .map((t) => t.id),
      );

      const projectGroupIds = new Set(
        db
          .select({ taskGroupId: tasks.taskGroupId })
          .from(tasks)
          .where(eq(tasks.projectId, input.projectId))
          .all()
          .map((t) => t.taskGroupId)
          .filter((id): id is number => id !== null),
      );

      return sessionsWithContext.filter(
        (s) =>
          (s.taskId !== null && projectTaskIds.has(s.taskId)) ||
          (s.taskGroupId !== null && projectGroupIds.has(s.taskGroupId)),
      );
    }),
});
