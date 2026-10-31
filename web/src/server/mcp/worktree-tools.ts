import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getDb } from '../db/client';
import { workspaces } from '../db/schema';
import { isInside, workspaceRepos } from '../terminal-spawn-scope';
import { getAppState, type AppState } from '../trpc/context';
import { dispatchGitWorktreeList } from '../ws/server';
import { mcpError, mcpResult } from './result';

const worktreeListInput = {
  workspaceSlug: z
    .string()
    .optional()
    .describe('Only list worktrees of this workspace. Omit for every workspace'),
};

function terminalsIn(state: AppState, worktreePath: string, repoWorktreePaths: string[]): string[] {
  const sessionIds: string[] = [];
  for (const [sessionId, meta] of state.terminalSessionMeta) {
    if (!meta.agentType || meta.dormant) continue;
    const cwd = meta.agentCwd ?? meta.workingDir;
    const owner = repoWorktreePaths
      .filter((candidate) => isInside(cwd, candidate))
      .sort((a, b) => b.length - a.length)[0];
    if (owner === worktreePath) sessionIds.push(sessionId);
  }
  return sessionIds;
}

export function registerWorktreeTools(mcp: McpServer): void {
  mcp.tool(
    'worktree_list',
    'List the git worktrees of every workspace repo (read-only), read from the daemon. Each row has the repo, worktree path, branch, whether it is the main checkout, and the live agent terminals working in it. Creating worktrees is not available here',
    worktreeListInput,
    async ({ workspaceSlug }) => {
      const state = getAppState();
      const rows = workspaceSlug
        ? getDb().select().from(workspaces).where(eq(workspaces.slug, workspaceSlug)).all()
        : getDb().select().from(workspaces).all();
      if (workspaceSlug && rows.length === 0) {
        return mcpError(`Unknown workspace '${workspaceSlug}'.`);
      }

      const repos = rows.flatMap((workspace) =>
        workspaceRepos(workspace).map((repoPath) => ({
          workspaceSlug: workspace.slug,
          repoPath,
        })),
      );
      const settled = await Promise.allSettled(
        repos.map(({ repoPath }) => dispatchGitWorktreeList(repoPath, state)),
      );

      const worktrees: unknown[] = [];
      const errors: Array<{ repoPath: string; message: string }> = [];
      settled.forEach((result, index) => {
        const { workspaceSlug: slug, repoPath } = repos[index];
        if (result.status === 'rejected') {
          const message =
            result.reason instanceof Error ? result.reason.message : String(result.reason);
          errors.push({ repoPath, message });
          return;
        }
        const repoWorktreePaths = result.value.worktrees.map((worktree) => worktree.path);
        for (const worktree of result.value.worktrees) {
          worktrees.push({
            workspaceSlug: slug,
            repoPath,
            path: worktree.path,
            branch: worktree.branch,
            isMain: worktree.isMain,
            isLocked: worktree.isLocked,
            terminals: terminalsIn(state, worktree.path, repoWorktreePaths),
          });
        }
      });

      return mcpResult({ worktrees, errors });
    },
  );
}
