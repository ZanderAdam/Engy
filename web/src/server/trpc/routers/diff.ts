import path from 'node:path';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import {
  dispatchGitStatus,
  dispatchGitLog,
  dispatchGitShow,
  dispatchGitBranchFiles,
  dispatchGitDefaultBase,
  dispatchGitFetch,
  dispatchGitWorktreeList,
} from '../../ws/server';
import { getDb } from '../../db/client';
import { workspaces } from '../../db/schema';
import type { GitWorktreeEntry } from '@engy/common';

type WorktreeLocation = 'local' | { coderWorkspace: string };

export interface TaggedWorktreeEntry extends GitWorktreeEntry {
  location: WorktreeLocation;
}

const worktreeInput = z.object({
  repoDir: z.string().min(1),
  worktreePath: z.string().optional(),
  coderWorkspace: z.string().optional(),
});

export const diffRouter = router({
  getStatus: publicProcedure.input(worktreeInput).query(async ({ input, ctx }) => {
    const dir = input.worktreePath ?? input.repoDir;
    return dispatchGitStatus(dir, ctx.state, input.coderWorkspace);
  }),

  getLog: publicProcedure
    .input(worktreeInput.extend({ maxCount: z.number().min(1).max(200).optional() }))
    .query(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      return dispatchGitLog(dir, ctx.state, input.maxCount, input.coderWorkspace);
    }),

  getCommitDiff: publicProcedure
    .input(worktreeInput.extend({ commitHash: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      return dispatchGitShow(dir, input.commitHash, ctx.state, input.coderWorkspace);
    }),

  getBranchDiff: publicProcedure
    .input(
      worktreeInput.extend({
        base: z.string().min(1),
        compareTo: z.enum(['worktree', 'head']).optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      try {
        const { files, mergeBase, head } = await dispatchGitBranchFiles(
          dir,
          input.base,
          ctx.state,
          input.coderWorkspace,
          input.compareTo,
        );
        return { files: files.map((f) => ({ ...f, staged: false })), mergeBase, head };
      } catch (err) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Invalid base ref "${input.base}": ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }),

  fetchBase: publicProcedure
    .input(worktreeInput.extend({ base: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const dir = input.worktreePath ?? input.repoDir;
      return dispatchGitFetch(dir, input.base, ctx.state, input.coderWorkspace);
    }),

  getDefaultBase: publicProcedure.input(worktreeInput).query(async ({ input, ctx }) => {
    const dir = input.worktreePath ?? input.repoDir;
    return dispatchGitDefaultBase(dir, ctx.state, input.coderWorkspace);
  }),

  getWorktrees: publicProcedure
    .input(z.object({ workspaceSlug: z.string(), repoDir: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const db = getDb();
      const workspace = db
        .select()
        .from(workspaces)
        .where(eq(workspaces.slug, input.workspaceSlug))
        .get();

      if (!workspace) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Workspace "${input.workspaceSlug}" not found`,
        });
      }

      const coderCfg =
        workspace.executionBackend === 'coder'
          ? (workspace.coderConfig as { workspace: string; repoBasePath: string } | null)
          : null;

      const results: TaggedWorktreeEntry[] = [];

      let localError: unknown;
      try {
        const { worktrees } = await dispatchGitWorktreeList(input.repoDir, ctx.state);
        for (const wt of worktrees) {
          results.push({ ...wt, location: 'local' });
        }
      } catch (err) {
        localError = err;
        console.error('[diff.getWorktrees] local worktree list failed:', err);
      }

      if (coderCfg?.workspace && coderCfg?.repoBasePath) {
        const remoteRepoPath = path.posix.join(coderCfg.repoBasePath, path.basename(input.repoDir));
        try {
          const { worktrees } = await dispatchGitWorktreeList(
            remoteRepoPath,
            ctx.state,
            coderCfg.workspace,
          );
          for (const wt of worktrees) {
            results.push({ ...wt, location: { coderWorkspace: coderCfg.workspace } });
          }
        } catch (err) {
          console.error('[diff.getWorktrees] coder worktree list failed:', err);
          if (localError !== undefined) {
            throw localError;
          }
        }
      } else if (localError !== undefined) {
        throw localError;
      }

      return results;
    }),
});
