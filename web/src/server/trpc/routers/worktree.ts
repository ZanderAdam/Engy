import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { getDb } from '../../db/client';
import { projects, workspaces } from '../../db/schema';
import {
  dispatchGitWorktreeList,
  dispatchWorktreeAdd,
  dispatchWorktreeRemove,
} from '../../ws/server';
import { getProjectWorktreeDir, branchToPathSegment } from '../../engy-dir/init';
import type { WorktreeAddErrorCode, WorktreeRemoveErrorCode } from '@engy/common';

const BRANCH_RE = /^[A-Za-z0-9._/-]+$/;

interface RepoSuccess {
  repoPath: string;
  success: true;
  worktreePath: string;
}

interface RepoFailure<E extends string> {
  repoPath: string;
  success: false;
  error: string;
  code: E;
}

type AddResult = RepoSuccess | RepoFailure<WorktreeAddErrorCode>;
type RemoveResult =
  | { repoPath: string; success: true }
  | RepoFailure<WorktreeRemoveErrorCode>;

function getProjectAndWorkspace(projectId: number) {
  const db = getDb();
  const project = db.select().from(projects).where(eq(projects.id, projectId)).get();
  if (!project) throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' });
  const workspace = db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, project.workspaceId))
    .get();
  if (!workspace) throw new TRPCError({ code: 'NOT_FOUND', message: 'Workspace not found' });
  return { project, workspace };
}

function workspaceRepos(workspace: { repos: unknown }): string[] {
  return (workspace.repos as string[] | null | undefined) ?? [];
}

function validateRepoSubset(workspace: { repos: unknown }, repoPaths: string[]): void {
  const set = new Set(workspaceRepos(workspace));
  for (const repo of repoPaths) {
    if (!set.has(repo)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: `Repo path not in workspace: ${repo}`,
      });
    }
  }
}

function errorCode<T extends string>(err: unknown, fallback: T): T {
  if (err instanceof Error) {
    const code = (err as unknown as { code?: unknown }).code;
    if (typeof code === 'string') return code as T;
  }
  return fallback;
}

export const worktreeRouter = router({
  /**
   * Enumerate worktrees across all `workspace.repos`, grouped by branch name.
   * Excludes main worktrees. Repos that fail to enumerate are silently omitted
   * (partial degradation).
   */
  listGrouped: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input, ctx }) => {
      const { workspace } = getProjectAndWorkspace(input.projectId);
      const repos = workspaceRepos(workspace);

      const results = await Promise.all(
        repos.map(async (repoPath) => {
          try {
            const { worktrees } = await dispatchGitWorktreeList(repoPath, ctx.state);
            return { repoPath, worktrees };
          } catch (err) {
            console.warn(`[worktree.listGrouped] git worktree list failed for ${repoPath}:`, err);
            return { repoPath, worktrees: [] };
          }
        }),
      );

      // branch → { repoPath → worktreePath }
      const byBranch = new Map<string, Map<string, string>>();
      for (const { repoPath, worktrees } of results) {
        for (const wt of worktrees) {
          if (wt.isMain || !wt.branch) continue;
          let inner = byBranch.get(wt.branch);
          if (!inner) {
            inner = new Map();
            byBranch.set(wt.branch, inner);
          }
          inner.set(repoPath, wt.path);
        }
      }

      const groups = [...byBranch.entries()]
        .map(([branch, repoMap]) => ({
          branch,
          repos: [...repoMap.entries()].map(([repoPath, worktreePath]) => ({
            repoPath,
            worktreePath,
          })),
        }))
        .sort((a, b) => a.branch.localeCompare(b.branch));

      return groups;
    }),

  /**
   * Create a worktree on `branch` in each selected repo. First repo carries
   * `createBranch` (when true); subsequent repos check out the (now existing)
   * branch. On any per-repo failure, rolls back the already-added repos.
   */
  create: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        branch: z.string().regex(BRANCH_RE, 'Invalid branch name'),
        repoPaths: z.array(z.string()).min(1),
        baseRef: z.string().optional(),
        createBranch: z.boolean().default(true),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { project, workspace } = getProjectAndWorkspace(input.projectId);
      validateRepoSubset(workspace, input.repoPaths);

      // Touch the branch slug to fail early on unsafe path segments.
      branchToPathSegment(input.branch);

      const succeeded: AddResult[] = [];
      for (let i = 0; i < input.repoPaths.length; i++) {
        const repoPath = input.repoPaths[i];
        const worktreePath = getProjectWorktreeDir(
          workspace,
          project.slug,
          input.branch,
          repoPath,
        );
        const createBranch = i === 0 ? input.createBranch : false;

        try {
          await dispatchWorktreeAdd(ctx.state, {
            repoDir: repoPath,
            worktreePath,
            branch: input.branch,
            createBranch,
            baseRef: createBranch ? input.baseRef : undefined,
          });
          succeeded.push({ repoPath, success: true, worktreePath });
        } catch (err) {
          // Rollback: remove what we already created. Track leaks so the user
          // can clean up by hand if a rollback step itself fails.
          const leaked: string[] = [];
          for (const prior of succeeded) {
            if (!prior.success) continue;
            try {
              await dispatchWorktreeRemove(ctx.state, {
                repoDir: prior.repoPath,
                worktreePath: prior.worktreePath,
                force: true,
              });
            } catch (rollbackErr) {
              console.warn(
                `[worktree.create] rollback failed for ${prior.repoPath}:`,
                rollbackErr,
              );
              leaked.push(prior.worktreePath);
            }
          }
          const code = errorCode<WorktreeAddErrorCode>(err, 'OTHER');
          const leakedNote =
            leaked.length > 0
              ? ` Rollback left orphaned worktree(s); remove manually: ${leaked.join(', ')}.`
              : '';
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: `Failed to create worktree in ${repoPath}: ${err instanceof Error ? err.message : String(err)} (${code}).${leakedNote}`,
          });
        }
      }

      return { branch: input.branch, repos: succeeded };
    }),

  /**
   * Materialize an existing branch in the given repos with `createBranch: false`.
   * Additive — no rollback on failure. Returns per-repo result list.
   */
  sync: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        branch: z.string().regex(BRANCH_RE, 'Invalid branch name'),
        repoPaths: z.array(z.string()).min(1),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<AddResult[]> => {
      const { project, workspace } = getProjectAndWorkspace(input.projectId);
      validateRepoSubset(workspace, input.repoPaths);
      branchToPathSegment(input.branch);

      const results = await Promise.all(
        input.repoPaths.map(async (repoPath): Promise<AddResult> => {
          const worktreePath = getProjectWorktreeDir(
            workspace,
            project.slug,
            input.branch,
            repoPath,
          );
          try {
            await dispatchWorktreeAdd(ctx.state, {
              repoDir: repoPath,
              worktreePath,
              branch: input.branch,
              createBranch: false,
            });
            return { repoPath, success: true, worktreePath };
          } catch (err) {
            return {
              repoPath,
              success: false,
              error: err instanceof Error ? err.message : String(err),
              code: errorCode<WorktreeAddErrorCode>(err, 'OTHER'),
            };
          }
        }),
      );
      return results;
    }),

  /**
   * Remove worktrees from each repo. Returns per-repo result list (no rollback).
   */
  remove: publicProcedure
    .input(
      z.object({
        projectId: z.number(),
        branch: z.string().regex(BRANCH_RE, 'Invalid branch name'),
        repoPaths: z.array(z.string()).min(1),
        force: z.boolean().default(false),
      }),
    )
    .mutation(async ({ input, ctx }): Promise<RemoveResult[]> => {
      const { project, workspace } = getProjectAndWorkspace(input.projectId);
      validateRepoSubset(workspace, input.repoPaths);

      const results = await Promise.all(
        input.repoPaths.map(async (repoPath): Promise<RemoveResult> => {
          const worktreePath = getProjectWorktreeDir(
            workspace,
            project.slug,
            input.branch,
            repoPath,
          );
          try {
            await dispatchWorktreeRemove(ctx.state, {
              repoDir: repoPath,
              worktreePath,
              force: input.force,
            });
            return { repoPath, success: true };
          } catch (err) {
            return {
              repoPath,
              success: false,
              error: err instanceof Error ? err.message : String(err),
              code: errorCode<WorktreeRemoveErrorCode>(err, 'OTHER'),
            };
          }
        }),
      );
      return results;
    }),
});
