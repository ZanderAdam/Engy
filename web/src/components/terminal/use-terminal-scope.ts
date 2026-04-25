"use client";

import { useVirtualParams } from "@/components/tabs/tab-context";
import { trpc } from "@/lib/trpc";
import { buildClaudeCommand, buildContextBlock } from '@/lib/shell';
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
): TerminalScope {
  if (projectSlug && projectId !== undefined) {
    const projectDir = `${workspaceDir}/projects/${projectSlug}`;
    const systemPrompt = buildContextBlock({
      workspace: { id: workspaceId, slug: workspaceSlug },
      project: { id: projectId, slug: projectSlug, dir: projectDir },
      repos,
    });
    return {
      scopeType: 'project',
      scopeLabel: `project: ${projectSlug}`,
      workingDir: projectDir,
      command: buildClaudeCommand({ systemPrompt, additionalDirs: repos }),
      groupKey: `project:${workspaceSlug}:${projectSlug}`,
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
  const workspaceSlug = params.workspace ?? '';
  const projectSlug = params.project;

  const { data: workspace } = trpc.workspace.get.useQuery(
    { slug: workspaceSlug },
    { enabled: !!workspaceSlug },
  );

  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

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
    return {
      scopeType: 'project',
      scopeLabel: `project: ${projectSlug}`,
      workingDir: `${workspace.resolvedDir}/projects/${projectSlug}`,
      command: buildClaudeCommand(),
      groupKey: `project:${workspaceSlug}:${projectSlug}`,
      workspaceSlug,
    };
  }

  const repos = Array.isArray(workspace.repos) ? (workspace.repos as string[]) : [];

  return deriveScope(workspaceSlug, workspace.resolvedDir, repos, workspace.id, projectSlug, project?.id);
}
