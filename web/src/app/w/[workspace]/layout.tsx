'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { RiGitRepositoryLine, RiGitRepositoryFill, RiComputerLine, RiBox3Line, RiGitBranchLine } from '@remixicon/react';
import {
  useVirtualParams,
  useVirtualPathname,
  useVirtualSearchParams,
  useTabId,
} from '@/components/tabs/tab-context';
import { VLink } from '@/components/tabs/virtual-link';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { ThreePanelLayout, type ShortcutDef, matchShortcut } from '@/components/layout/three-panel-layout';
import { MobileOverlayProvider } from '@/components/layout/mobile-overlay-context';
import { WorkspaceMobileTerminalToggle } from '@/components/layout/workspace-mobile-terminal-toggle';
import {
  MobileTerminalSheet,
  MobileShellTerminalSheet,
} from '@/components/layout/mobile-terminal-sheet';
import { TerminalPanel } from '@/components/terminal/terminal-panel';
import { TerminalRail } from '@/components/terminal/terminal-rail';
import { BottomTerminalSplit } from '@/components/terminal/bottom-terminal-split';
import type { TerminalDropdownGroup, TerminalDropdownEntry } from '@/components/terminal/types';
import { useWorktreeSessions } from '@/components/terminal/use-worktree-sessions';
import { EventsProvider } from '@/contexts/events-context';
import { useTaskAutoInvalidation } from '@/hooks/use-task-auto-invalidation';
import { useQuestionAutoInvalidation } from '@/hooks/use-question-auto-invalidation';
import { useProjectActivityFeed } from '@/hooks/use-project-activity';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import { projectGroupKey, normalizeWtParam } from '@/components/terminal/group-key';
import { buildContextBlock } from '@/lib/shell';
import { buildAgentCommand, getMcpUrl, getAgentType, coerceAgentTypeId } from '@/lib/agent-types';
import { QuickCaptureDialog } from '@/components/memory/quick-capture-dialog';

const TERMINAL_CONFIG = {
  defaultWidth: 480,
  minWidth: 240,
  maxWidth: 900,
  storageKey: 'engy-terminal-width',
} as const;

const TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: '`' };
const QUICK_CAPTURE_SHORTCUT: ShortcutDef = { mod: true, shift: true, key: 'm' };

const tabs = [
  { label: 'Overview', segment: '' },
  { label: 'Tasks', segment: 'tasks' },
  { label: 'Docs', segment: 'docs' },
  { label: 'Memory', segment: 'memory' },
] as const;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useVirtualParams<{ workspace: string; project?: string }>();
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const tabId = useTabId();
  const {
    data: workspace,
    isLoading,
    error,
  } = trpc.workspace.get.useQuery({ slug: params.workspace });

  const isMobile = useIsMobile();
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);
  const [quickCaptureOpen, setQuickCaptureOpen] = useState(false);

  // Auto-expand terminal when active sessions are restored on page load.
  // Filter by tabId so only this tab's TerminalManager triggers expansion.
  useEffect(() => {
    function onActiveChanged(e: Event) {
      const detail = (e as CustomEvent<{ hasActiveTab: boolean; tabId?: string }>).detail;
      if (detail.tabId !== undefined && detail.tabId !== tabId) return;
      if (detail.hasActiveTab) setTerminalCollapsed(false);
    }
    window.addEventListener('terminal:active-changed', onActiveChanged);
    return () => window.removeEventListener('terminal:active-changed', onActiveChanged);
  }, [tabId]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (matchShortcut(QUICK_CAPTURE_SHORTCUT, e)) {
        e.preventDefault();
        setQuickCaptureOpen(true);
      }
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  const handleCollapse = useCallback(() => {
    setTerminalCollapsed(true);
  }, []);

  const basePath = `/w/${params.workspace}`;
  const isProjectRoute = pathname.startsWith(`${basePath}/projects/`);
  const isDocsRoute = pathname.startsWith(`${basePath}/docs`);
  const isMemoryRoute = pathname.startsWith(`${basePath}/memory`);

  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project ?? '' },
    { enabled: isProjectRoute && !!workspace && !!params.project },
  );

  const isContainerEnabled = workspace?.containerEnabled ?? false;

  const combined = workspace?.combinedWorktrees ?? false;
  const { repoMap: worktreeRepoMap, allGroups: worktreeGroups } = useProjectWorktreeMap({
    projectId: isProjectRoute ? project?.id : undefined,
    combined,
  });
  // Use the raw `?wt` URL param (not the resolved/materialized branch) so the
  // groupKey isolates terminal sessions per tab even when the worktree hasn't
  // been created yet for this repo. Ignored in combined mode (one groupKey).
  const worktreeBranch = combined ? undefined : normalizeWtParam(searchParams.get('wt'));

  const extraDropdownGroups = useMemo<TerminalDropdownGroup[] | undefined>(() => {
    if (!isProjectRoute || !workspace) return undefined;
    const repos = (workspace.repos as string[]) ?? [];
    if (repos.length === 0) return undefined;

    const projectSlug = params.project;
    const projectDir =
      projectSlug && workspace.resolvedDir
        ? `${workspace.resolvedDir}/projects/${projectSlug}`
        : undefined;

    const systemPrompt =
      project && projectSlug && projectDir
        ? buildContextBlock({
            workspace: { id: workspace.id, slug: params.workspace },
            project: { id: project.id, slug: projectSlug, dir: projectDir },
            repos,
          })
        : undefined;

    const hostMode = isContainerEnabled ? ('host' as const) : undefined;
    // Repo/worktree entries launch the workspace's default agent; a different
    // agent is picked per-terminal from the New Terminal menu.
    const agentTypeId = coerceAgentTypeId(workspace.defaultAgentType);
    const agentTitle = getAgentType(agentTypeId).label;
    const agentLabel = agentTitle.toLowerCase();

    /**
     * Build a "Claude in Repos" dropdown group for one worktree. `branch` is the
     * worktree branch (undefined = default). `repoMap` maps each main repo path
     * to its worktree checkout for this branch; missing repos fall back to main.
     * All entries share `groupKey` so combined mode keeps every worktree's
     * terminals in a single manager, while `scope.worktreeBranch` drives grouping.
     */
    function buildRepoGroup(
      label: string,
      branch: string | undefined,
      repoMap: Map<string, string>,
      groupKey: string,
    ): TerminalDropdownGroup {
      // Split mode keeps the pre-combined labels (no branch suffix) — the whole
      // panel is already scoped to the active `?wt`. `worktreeBranch` is still
      // set so every split terminal stays in one rail group (no header).
      const effectiveRepo = (repoPath: string): string => repoMap.get(repoPath) ?? repoPath;

      function makeRepoEntry(
        repoPath: string,
        mode: 'host' | 'container' | undefined,
      ): TerminalDropdownGroup['entries'][number] {
        const effective = effectiveRepo(repoPath);
        const dirName = effective.split('/').filter(Boolean).pop() ?? effective;
        const isContainer = mode === 'container';
        const additionalDirs = projectDir ? [projectDir] : undefined;
        return {
          id: `${isContainer ? 'container:' : ''}repo:${repoPath}:${branch ?? ''}`,
          label: isContainer ? `${dirName} (Container)` : dirName,
          tooltip: effective,
          scope: {
            scopeType: 'project',
            scopeLabel: `${agentLabel}: ${dirName}`,
            workingDir: effective,
            command: buildAgentCommand(agentTypeId, {
              systemPrompt,
              additionalDirs,
              dangerouslySkipPermissions: isContainer,
              mcpUrl: getMcpUrl(),
            }),
            groupKey,
            workspaceSlug: params.workspace,
            containerMode: mode,
            projectId: project?.id,
            projectSlug: params.project,
            worktreeBranch: branch,
            agentType: agentTypeId,
            agentContext: { systemPrompt, additionalDirs },
          },
          icon: isContainer ? RiBox3Line : isContainerEnabled ? RiComputerLine : RiGitRepositoryLine,
        };
      }

      function makeAllReposEntry(
        mode: 'host' | 'container' | undefined,
      ): TerminalDropdownGroup['entries'][number] {
        const effectiveRepos = repos.map(effectiveRepo);
        const isContainer = mode === 'container';
        const primary = repos.find((r) => repoMap.has(r));
        const primaryEffective = primary ? effectiveRepo(primary) : effectiveRepos[0];
        const additional = effectiveRepos.filter((r) => r !== primaryEffective);
        const additionalDirs = [...(projectDir ? [projectDir] : []), ...additional];
        return {
          id: `${isContainer ? 'container:' : ''}repo:all:${branch ?? ''}`,
          label: isContainer ? 'All Repos (Container)' : 'All Repos',
          tooltip: effectiveRepos.join(', '),
          scope: {
            scopeType: 'project',
            scopeLabel: `${agentLabel}: all repos`,
            workingDir: primaryEffective,
            command: buildAgentCommand(agentTypeId, {
              systemPrompt,
              additionalDirs,
              dangerouslySkipPermissions: isContainer,
              mcpUrl: getMcpUrl(),
            }),
            groupKey,
            workspaceSlug: params.workspace,
            containerMode: mode,
            projectId: project?.id,
            projectSlug: params.project,
            worktreeBranch: branch,
            agentType: agentTypeId,
            agentContext: { systemPrompt, additionalDirs },
          },
          icon: isContainer ? RiBox3Line : isContainerEnabled ? RiComputerLine : RiGitRepositoryFill,
        };
      }

      const entries: TerminalDropdownGroup['entries'] = [];
      for (const repoPath of repos) {
        entries.push(makeRepoEntry(repoPath, hostMode));
        if (isContainerEnabled) entries.push(makeRepoEntry(repoPath, 'container'));
      }
      if (repos.length > 1) {
        entries.push(makeAllReposEntry(hostMode));
        if (isContainerEnabled) entries.push(makeAllReposEntry('container'));
      }
      return { label, entries };
    }

    // Combined mode: organise the menu BY REPO. Each repo is a submenu whose
    // items are "default branch" + that repo's worktrees (so a repo with many
    // worktrees stays one compact row). All entries share one project-level
    // groupKey; `scope.worktreeBranch` drives rail grouping of open terminals.
    if (combined) {
      const groupKey = projectGroupKey(params.workspace, projectSlug ?? '');
      const basename = (p: string): string => p.split('/').filter(Boolean).pop() ?? p;
      const modes: Array<'host' | 'container' | undefined> = isContainerEnabled
        ? ['host', 'container']
        : [undefined];

      function leaf(
        id: string,
        label: string,
        scopeLabel: string,
        workingDir: string,
        branch: string | undefined,
        additionalDirs: string[] | undefined,
        mode: 'host' | 'container' | undefined,
        icon: TerminalDropdownEntry['icon'],
      ): TerminalDropdownEntry {
        const isContainer = mode === 'container';
        const effectiveDirs = additionalDirs ?? (projectDir ? [projectDir] : undefined);
        return {
          id,
          label: isContainer ? `${label} (Container)` : label,
          tooltip: workingDir,
          scope: {
            scopeType: 'project',
            scopeLabel,
            workingDir,
            command: buildAgentCommand(agentTypeId, {
              systemPrompt,
              additionalDirs: effectiveDirs,
              dangerouslySkipPermissions: isContainer,
              mcpUrl: getMcpUrl(),
            }),
            groupKey,
            workspaceSlug: params.workspace,
            containerMode: mode,
            projectId: project?.id,
            projectSlug: params.project,
            worktreeBranch: branch,
            agentType: agentTypeId,
            agentContext: { systemPrompt, additionalDirs: effectiveDirs },
          },
          icon,
        };
      }

      function repoSubmenu(repoPath: string): TerminalDropdownEntry {
        const dirName = basename(repoPath);
        const children: TerminalDropdownEntry[] = [];
        for (const mode of modes) {
          children.push(
            leaf(`repo:${repoPath}::${mode ?? ''}`, 'default branch', `${agentLabel}: ${dirName}`,
              repoPath, undefined, undefined, mode, RiGitRepositoryLine),
          );
        }
        for (const g of worktreeGroups) {
          const wt = g.repos.find((r) => r.repoPath === repoPath)?.worktreePath;
          if (!wt) continue;
          for (const mode of modes) {
            children.push(
              leaf(`repo:${repoPath}:${g.branch}:${mode ?? ''}`, g.branch,
                `${agentLabel}: ${dirName} (${g.branch})`, wt, g.branch, undefined, mode, RiGitBranchLine),
            );
          }
        }
        return {
          id: `repo-submenu:${repoPath}`,
          label: dirName,
          children,
          icon: isContainerEnabled ? RiComputerLine : RiGitRepositoryLine,
        };
      }

      function allReposSubmenu(): TerminalDropdownEntry {
        const children: TerminalDropdownEntry[] = [];
        const addRow = (branch: string | undefined, effective: (r: string) => string) => {
          const eff = repos.map(effective);
          // Prefer a materialized worktree checkout as the primary cwd so the
          // terminal opens inside the worktree (not the main repo) when repos[0]
          // has no checkout for this branch.
          const primaryIdx = repos.findIndex((r) => effective(r) !== r);
          const resolvedPrimaryIdx = primaryIdx >= 0 ? primaryIdx : 0;
          const primary = eff[resolvedPrimaryIdx];
          // Filter by index (not value) so two repos resolving to the same path
          // can't silently drop one from the --add-dir list.
          const additional = eff.filter((_, i) => i !== resolvedPrimaryIdx);
          for (const mode of modes) {
            children.push(
              leaf(`all:${branch ?? ''}:${mode ?? ''}`, branch ?? 'default branch',
                branch ? `${agentLabel}: all repos (${branch})` : `${agentLabel}: all repos`,
                primary, branch, [...(projectDir ? [projectDir] : []), ...additional], mode,
                RiGitRepositoryFill),
            );
          }
        };
        addRow(undefined, (r) => r);
        for (const g of worktreeGroups) {
          const map = new Map(g.repos.map((r) => [r.repoPath, r.worktreePath]));
          addRow(g.branch, (r) => map.get(r) ?? r);
        }
        return { id: 'repo-submenu:all', label: 'All Repos', children, icon: RiGitRepositoryFill };
      }

      const entries: TerminalDropdownEntry[] = repos.map(repoSubmenu);
      if (repos.length > 1) entries.push(allReposSubmenu());
      return [{ label: `${agentTitle} in Repos`, entries }];
    }

    const groupKey = projectGroupKey(params.workspace, projectSlug ?? '', worktreeBranch);
    return [buildRepoGroup(`${agentTitle} in Repos`, worktreeBranch, worktreeRepoMap, groupKey)];
  }, [
    isProjectRoute,
    workspace,
    project,
    params.project,
    params.workspace,
    isContainerEnabled,
    combined,
    worktreeBranch,
    worktreeRepoMap,
    worktreeGroups,
  ]);

  const worktreeGroup = useWorktreeSessions(params.workspace);

  const allDropdownGroups = useMemo<TerminalDropdownGroup[] | undefined>(() => {
    const groups: TerminalDropdownGroup[] = [];
    if (extraDropdownGroups) groups.push(...extraDropdownGroups);
    if (worktreeGroup) groups.push(worktreeGroup);
    return groups.length > 0 ? groups : undefined;
  }, [extraDropdownGroups, worktreeGroup]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium">Workspace not found</p>
        <p className="text-xs text-muted-foreground">
          The workspace &ldquo;{params.workspace}&rdquo; does not exist.
        </p>
        <VLink href="/" className="mt-2 text-xs text-primary underline">
          Back to home
        </VLink>
      </div>
    );
  }

  function tabHref(segment: string): string {
    return segment ? `${basePath}/${segment}` : basePath;
  }

  function isActive(segment: string): boolean {
    if (segment === '') return pathname === basePath;
    return pathname.startsWith(`${basePath}/${segment}`);
  }

  const content = (
    <>
      <AutoInvalidation />
      <QuickCaptureDialog
        open={quickCaptureOpen}
        onOpenChange={setQuickCaptureOpen}
        workspaceSlug={params.workspace}
      />
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {!isProjectRoute && (
          <nav className="border-b border-border" aria-label="Workspace sections">
            <div className={cn('flex items-center', isMobile ? 'px-3' : 'px-6')}>
              {tabs.map((tab) => (
                <VLink
                  key={tab.segment}
                  href={tabHref(tab.segment)}
                  className={cn(
                    'relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                    isActive(tab.segment) &&
                      'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground',
                  )}
                >
                  {tab.label}
                </VLink>
              ))}
              {/* Mobile-only: the workspace nav has no MobileHeader, so it hosts
                  the terminal overlay toggle itself (desktop uses TerminalRail). */}
              {isMobile && (
                <div className="ml-auto pl-2">
                  <WorkspaceMobileTerminalToggle />
                </div>
              )}
            </div>
          </nav>
        )}
        <ThreePanelLayout
          className="flex-1 min-h-0"
          right={TERMINAL_CONFIG}
          rightCollapsed={terminalCollapsed}
          onRightCollapsedChange={setTerminalCollapsed}
          rightShortcut={TERMINAL_SHORTCUT}
          isMobile={isMobile}
          rightRail={
            !isMobile
              ? ({ collapsed, setCollapsed }) => (
                  <TerminalRail
                    collapsed={collapsed}
                    setCollapsed={setCollapsed}
                    extraDropdownGroups={allDropdownGroups}
                    containerEnabled={isContainerEnabled}
                  />
                )
              : undefined
          }
          centerContent={
            <BottomTerminalSplit
              isMobile={isMobile}
              extraDropdownGroups={allDropdownGroups}
              containerEnabled={isContainerEnabled}
            >
              <div
                className={cn(
                  'flex min-h-0 flex-1 flex-col overflow-hidden',
                  !isDocsRoute && !isMemoryRoute && (isMobile ? 'px-2' : 'px-6'),
                )}
              >
                {children}
              </div>
            </BottomTerminalSplit>
          }
          rightContent={
            <TerminalPanel
              onCollapse={handleCollapse}
              extraDropdownGroups={allDropdownGroups}
              containerEnabled={isContainerEnabled}
            />
          }
        />
      </div>
    </>
  );

  return (
    <EventsProvider workspaceSlug={params.workspace}>
      {isMobile ? (
        <MobileOverlayProvider>
          {content}
          {/* RIGHT terminal (Claude) — opened from the mobile header */}
          <MobileTerminalSheet
            extraDropdownGroups={allDropdownGroups}
            containerEnabled={isContainerEnabled}
          />
          {/* BOTTOM terminal (shell) — opened from the floating toggle */}
          <MobileShellTerminalSheet
            extraDropdownGroups={allDropdownGroups}
            containerEnabled={isContainerEnabled}
          />
        </MobileOverlayProvider>
      ) : (
        content
      )}
    </EventsProvider>
  );
}

function AutoInvalidation() {
  useTaskAutoInvalidation();
  useQuestionAutoInvalidation();
  useProjectActivityFeed();
  return null;
}
