"use client";

import { useVirtualParams, useVirtualSearchParams } from "@/components/tabs/tab-context";
import { trpc } from "@/lib/trpc";
import { buildClaudeCommand, buildContextBlock } from '@/lib/shell';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import type { TerminalScope } from "./types";

// ── Default terminal scope logic — DO NOT CHANGE ──────────────────────
// When starting Claude from the terminal panel (not task quick actions):
//   - Working dir = projectDir (so Claude has project context)
//   - Additional dirs = ALL repos via --add-dir flags
// This is DIFFERENT from task quick actions which start in the 1st repo.
// See shell.ts buildQuickActionDirs() for the quick-action logic.
export function deriveScope(
  workspaceSlug: string,
  workspaceDir: string,
  repos: string[],
  workspaceId: number,
  projectSlug?: string,
  projectId?: number,
  worktreeBranch?: string,
): TerminalScope {
  if (projectSlug && projectId !== undefined) {
    const projectDir = `${workspaceDir}/projects/${projectSlug}`;
    const systemPrompt = buildContextBlock({
      workspace: { id: workspaceId, slug: workspaceSlug },
      project: { id: projectId, slug: projectSlug, dir: projectDir },
      repos,
    });
    const baseKey = `project:${workspaceSlug}:${projectSlug}`;
    return {
      scopeType: 'project',
      scopeLabel: worktreeBranch
        ? `project: ${projectSlug} (${worktreeBranch})`
        : `project: ${projectSlug}`,
      workingDir: projectDir,
      command: buildClaudeCommand({ systemPrompt, additionalDirs: repos }),
      groupKey: worktreeBranch ? `${baseKey}:wt:${worktreeBranch}` : baseKey,
      workspaceSlug,
    };
  }

  const systemPrompt = buildContextBlock({
    workspace: { id: workspaceId, slug: workspaceSlug },
    repos,
  });
  return {
    scopeType: 'workspace',
    scopeLabel: workspaceSlug,
    workingDir: workspaceDir,
    command: buildClaudeCommand({ systemPrompt, additionalDirs: repos }),
    groupKey: `workspace:${workspaceSlug}`,
    workspaceSlug,
  };
}

export function deriveShellScope(scope: TerminalScope): TerminalScope {
  return {
    ...scope,
    command: undefined,
    groupKey: `shell:${scope.groupKey}`,
    scopeLabel: `shell: ${scope.scopeLabel}`,
  };
}

export function useBottomTerminalScope(): TerminalScope {
  const scope = useTerminalScope();
  return deriveShellScope(scope);
}

export function useTerminalScope(): TerminalScope {
  const params = useVirtualParams();
  const searchParams = useVirtualSearchParams();
  const workspaceSlug = params.workspace ?? '';
  const projectSlug = params.project;
  // Use the raw `?wt` URL param so each branch (even pre-materialization) gets
  // its own groupKey. Path substitution below uses the resolved repoMap, which
  // is empty until a worktree directory exists.
  const worktreeBranch = searchParams.get('wt') ?? undefined;

  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );

  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

  const { repoMap: worktreeRepoMap } = useProjectWorktreeMap({
    projectId: project?.id,
  });

  if (!workspace) {
    return {
      scopeType: 'workspace',
      scopeLabel: workspaceSlug,
      workingDir: '',
      command: buildClaudeCommand(),
      groupKey: `workspace:${workspaceSlug}`,
      workspaceSlug,
    };
  }

  if (projectSlug && !project) {
    const baseKey = `project:${workspaceSlug}:${projectSlug}`;
    return {
      scopeType: 'project',
      scopeLabel: worktreeBranch
        ? `project: ${projectSlug} (${worktreeBranch})`
        : `project: ${projectSlug}`,
      workingDir: `${workspace.resolvedDir}/projects/${projectSlug}`,
      command: buildClaudeCommand(),
      groupKey: worktreeBranch ? `${baseKey}:wt:${worktreeBranch}` : baseKey,
      workspaceSlug,
    };
  }

  const repos = Array.isArray(workspace.repos) ? (workspace.repos as string[]) : [];
  const effectiveRepos = worktreeBranch
    ? repos.map((r) => worktreeRepoMap.get(r) ?? r)
    : repos;

  return deriveScope(
    workspaceSlug,
    workspace.resolvedDir,
    effectiveRepos,
    workspace.id,
    projectSlug,
    project?.id,
    worktreeBranch,
  );
}
