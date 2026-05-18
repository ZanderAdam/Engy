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
import {
  getProjectWorktreeDir,
  branchToPathSegment,
  validateNoBasenameCollisions,
} from '../../engy-dir/init';
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
   * Excludes main worktrees. Repos that fail to enumerate are recorded in
   * `errors` rather than silently dropped — callers can surface the failures.
   */
  listGrouped: publicProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input, ctx }) => {
      const { workspace } = getProjectAndWorkspace(input.projectId);
      const repos = workspaceRepos(workspace);

      const settled = await Promise.allSettled(
        repos.map(async (repoPath) => {
          const { worktrees } = await dispatchGitWorktreeList(repoPath, ctx.state);
          return { repoPath, worktrees };
        }),
      );

      const errors: Array<{ repoPath: string; message: string }> = [];

      // branch → { repoPath → worktreePath }
      const byBranch = new Map<string, Map<string, string>>();
      settled.forEach((result, i) => {
        const repoPath = repos[i];
        if (result.status === 'rejected') {
          const message =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push({ repoPath, message });
          return;
        }
        for (const wt of result.value.worktrees) {
          if (wt.isMain || !wt.branch) continue;
          let inner = byBranch.get(wt.branch);
          if (!inner) {
            inner = new Map();
            byBranch.set(wt.branch, inner);
          }
          inner.set(repoPath, wt.path);
        }
      });

      const groups = [...byBranch.entries()]
        .map(([branch, repoMap]) => ({
          branch,
          repos: [...repoMap.entries()].map(([repoPath, worktreePath]) => ({
            repoPath,
            worktreePath,
          })),
        }))
        .sort((a, b) => a.branch.localeCompare(b.branch));

      return { groups, errors };
    }),

  /**
   * Create a worktree on `branch` in each selected repo. Repo[0] runs first
   * (it carries `createBranch: true` when applicable); repos[1..N] run in
   * parallel against the now-existing branch. On any failure, all already-added
   * repos are rolled back.
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
      validateNoBasenameCollisions(input.repoPaths);

      // Fail early on unsafe path segments.
      branchToPathSegment(input.branch);

      async function rollback(succeeded: AddResult[]): Promise<string[]> {
        const leaked: string[] = [];
        await Promise.allSettled(
          succeeded
            .filter((r): r is RepoSuccess => r.success)
            .map(async (prior) => {
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
            }),
        );
        return leaked;
      }

      function buildError(
        failedRepo: string,
        err: unknown,
        leaked: string[],
      ): TRPCError {
        const code = errorCode<WorktreeAddErrorCode>(err, 'OTHER');
        const leakedNote =
          leaked.length > 0
            ? ` Rollback left orphaned worktree(s); remove manually: ${leaked.join(', ')}.`
            : '';
        return new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: `Failed to create worktree in ${failedRepo}: ${err instanceof Error ? err.message : String(err)} (${code}).${leakedNote}`,
        });
      }

      const [firstRepo, ...restRepos] = input.repoPaths;
      const firstWorktreePath = getProjectWorktreeDir(workspace, project.slug, input.branch, firstRepo);

      // Step 1: run repo[0] alone so the branch is created before others check it out.
      let firstResult: RepoSuccess;
      try {
        await dispatchWorktreeAdd(ctx.state, {
          repoDir: firstRepo,
          worktreePath: firstWorktreePath,
          branch: input.branch,
          createBranch: input.createBranch,
          baseRef: input.createBranch ? input.baseRef : undefined,
        });
        firstResult = { repoPath: firstRepo, success: true, worktreePath: firstWorktreePath };
      } catch (err) {
        throw buildError(firstRepo, err, []);
      }

      if (restRepos.length === 0) {
        return { branch: input.branch, repos: [firstResult] };
      }

      // Step 2: run repos[1..N] in parallel with createBranch: false.
      const restSettled = await Promise.allSettled(
        restRepos.map(async (repoPath): Promise<RepoSuccess> => {
          const worktreePath = getProjectWorktreeDir(workspace, project.slug, input.branch, repoPath);
          await dispatchWorktreeAdd(ctx.state, {
            repoDir: repoPath,
            worktreePath,
            branch: input.branch,
            createBranch: false,
          });
          return { repoPath, success: true, worktreePath };
        }),
      );

      // Collect successes and the first failure.
      const succeeded: AddResult[] = [firstResult];
      let firstFailureRepo: string | null = null;
      let firstFailureErr: unknown = null;

      restSettled.forEach((result, i) => {
        if (result.status === 'fulfilled') {
          succeeded.push(result.value);
        } else {
          if (firstFailureRepo === null) {
            firstFailureRepo = restRepos[i];
            firstFailureErr = result.reason;
          }
        }
      });

      if (firstFailureRepo !== null) {
        const leaked = await rollback(succeeded);
        throw buildError(firstFailureRepo, firstFailureErr, leaked);
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
      validateNoBasenameCollisions(input.repoPaths);
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
