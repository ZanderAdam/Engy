"use client";

import { useVirtualParams, useVirtualSearchParams } from "@/components/tabs/tab-context";
import { trpc } from "@/lib/trpc";
import { buildContextBlock } from '@/lib/shell';
import { buildAgentCommand, getMcpUrl, coerceAgentTypeId, type AgentTypeId } from '@/lib/agent-types';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import type { TerminalScope } from "./types";
import { projectGroupKey, workspaceGroupKey, normalizeWtParam } from './group-key';

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
  earsBdd?: boolean,
  agentType: AgentTypeId = 'claude',
): TerminalScope {
  if (projectSlug && projectId !== undefined) {
    const projectDir = `${workspaceDir}/projects/${projectSlug}`;
    const systemPrompt = buildContextBlock({
      workspace: { id: workspaceId, slug: workspaceSlug },
      project: { id: projectId, slug: projectSlug, dir: projectDir },
      repos,
      earsBdd,
    });
    return {
      scopeType: 'project',
      scopeLabel: worktreeBranch
        ? `project: ${projectSlug} (${worktreeBranch})`
        : `project: ${projectSlug}`,
      workingDir: projectDir,
      command: buildAgentCommand(agentType, {
        systemPrompt,
        additionalDirs: repos,
        mcpUrl: getMcpUrl(),
      }),
      groupKey: projectGroupKey(workspaceSlug, projectSlug, worktreeBranch),
      workspaceSlug,
      projectId,
      projectSlug,
      worktreeBranch,
      agentType,
      agentContext: { systemPrompt, additionalDirs: repos },
    };
  }

  const systemPrompt = buildContextBlock({
    workspace: { id: workspaceId, slug: workspaceSlug },
    repos,
    earsBdd,
  });
  return {
    scopeType: 'workspace',
    scopeLabel: workspaceSlug,
    workingDir: workspaceDir,
    command: buildAgentCommand(agentType, {
      systemPrompt,
      additionalDirs: repos,
      mcpUrl: getMcpUrl(),
    }),
    groupKey: workspaceGroupKey(workspaceSlug),
    workspaceSlug,
    agentType,
    agentContext: { systemPrompt, additionalDirs: repos },
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

  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );

  // In combined mode all worktrees share one project-level groupKey, so the
  // default terminal targets the default branch and ignores `?wt`. In split mode
  // each branch gets its own groupKey (path substitution below uses the resolved
  // repoMap, empty until the worktree exists — so an unmaterialized branch still
  // gets a unique groupKey while `--add-dir` flags fall back to the main repos).
  const combined = workspace?.combinedWorktrees ?? false;
  const worktreeBranch = combined ? undefined : normalizeWtParam(searchParams.get('wt'));

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
      command: buildAgentCommand('claude', { mcpUrl: getMcpUrl() }),
      groupKey: workspaceGroupKey(workspaceSlug),
      workspaceSlug,
      agentType: 'claude',
      agentContext: {},
    };
  }

  const agentType = coerceAgentTypeId(workspace.defaultAgentType);

  if (projectSlug && !project) {
    return {
      scopeType: 'project',
      scopeLabel: worktreeBranch
        ? `project: ${projectSlug} (${worktreeBranch})`
        : `project: ${projectSlug}`,
      workingDir: `${workspace.resolvedDir}/projects/${projectSlug}`,
      command: buildAgentCommand(agentType, { mcpUrl: getMcpUrl() }),
      groupKey: projectGroupKey(workspaceSlug, projectSlug, worktreeBranch),
      workspaceSlug,
      projectSlug,
      agentType,
      agentContext: {},
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
    workspace.earsBdd ?? false,
    agentType,
  );
}
