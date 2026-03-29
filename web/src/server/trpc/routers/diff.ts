import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  dispatchGitStatus,
  dispatchGitLog,
  dispatchGitShow,
  dispatchGitBranchFiles,
} from '../../ws/server';
import { getDb } from '../../db/client';
import { agentSessions, tasks, taskGroups } from '../../db/schema';
import { resolveRepoDir, sessionIdParam } from './shared';

export const diffRouter = router({
  getStatus: publicProcedure
    .input(z.object({ repoDir: z.string().min(1), sessionId: sessionIdParam }))
    .query(async ({ input, ctx }) => {
      const dir = resolveRepoDir(input.repoDir, input.sessionId);
      return dispatchGitStatus(dir, ctx.state);
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

      // Batch-fetch referenced tasks and groups (avoid N+1)
      const taskIds = [...new Set(allSessions.map((s) => s.taskId).filter(Boolean))] as number[];
      const groupIds = [
        ...new Set(allSessions.map((s) => s.taskGroupId).filter(Boolean)),
      ] as number[];

      const taskMap = new Map(
        taskIds.length > 0
          ? db
              .select({ id: tasks.id, title: tasks.title })
              .from(tasks)
              .where(inArray(tasks.id, taskIds))
              .all()
              .map((t) => [t.id, t.title])
          : [],
      );
      const groupMap = new Map(
        groupIds.length > 0
          ? db
              .select({ id: taskGroups.id, name: taskGroups.name })
              .from(taskGroups)
              .where(inArray(taskGroups.id, groupIds))
              .all()
              .map((g) => [g.id, g.name])
          : [],
      );

      const sessionsWithContext = allSessions.map((session) => ({
        ...session,
        taskTitle: session.taskId ? (taskMap.get(session.taskId) ?? null) : null,
        groupName: session.taskGroupId ? (groupMap.get(session.taskGroupId) ?? null) : null,
      }));

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
