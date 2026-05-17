import { effectiveDocsDirForBranch } from './init';
import type { AppState } from '../trpc/context';

export async function resolveEffectiveWorkspace(
  workspace: { slug: string; docsDir: string | null; repos: unknown },
  worktreeBranch: string | undefined,
  state: AppState,
): Promise<{ slug: string; docsDir: string | null }> {
  if (!worktreeBranch) {
    return { slug: workspace.slug, docsDir: workspace.docsDir };
  }
  const docsDir = await effectiveDocsDirForBranch(workspace, worktreeBranch, state);
  return { slug: workspace.slug, docsDir };
}
