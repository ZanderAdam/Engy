'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { RiGitRepositoryLine, RiGitRepositoryFill, RiComputerLine, RiBox3Line } from '@remixicon/react';
import { useVirtualParams, useVirtualPathname } from '@/components/tabs/tab-context';
import { VLink } from '@/components/tabs/virtual-link';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { ThreePanelLayout, type ShortcutDef } from '@/components/layout/three-panel-layout';
import { TerminalPanel } from '@/components/terminal/terminal-panel';
import { BottomTerminalSplit } from '@/components/terminal/bottom-terminal-split';
import type { TerminalDropdownGroup } from '@/components/terminal/types';
import { useWorktreeSessions } from '@/components/terminal/use-worktree-sessions';
import { EventsProvider } from '@/contexts/events-context';
import { useTaskAutoInvalidation } from '@/hooks/use-task-auto-invalidation';
import { useQuestionAutoInvalidation } from '@/hooks/use-question-auto-invalidation';
import { buildClaudeCommand, buildContextBlock } from '@/lib/shell';

const TERMINAL_CONFIG = {
  defaultWidth: 480,
  minWidth: 240,
  maxWidth: 900,
  storageKey: 'engy-terminal-width',
} as const;

const TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: '`' };

const tabs = [
  { label: 'Overview', segment: '' },
  { label: 'Tasks', segment: 'tasks' },
  { label: 'Docs', segment: 'docs' },
  { label: 'Memory', segment: 'memory' },
] as const;

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useVirtualParams<{ workspace: string; project?: string }>();
  const pathname = useVirtualPathname();
  const {
    data: workspace,
    isLoading,
    error,
  } = trpc.workspace.get.useQuery({ slug: params.workspace });

  const isMobile = useIsMobile();
  const [terminalCollapsed, setTerminalCollapsed] = useState(true);

  // Auto-expand terminal when active sessions are restored on page load
  useEffect(() => {
    function onActiveChanged(e: Event) {
      const { hasActiveTab } = (e as CustomEvent<{ hasActiveTab: boolean }>).detail;
      if (hasActiveTab) setTerminalCollapsed(false);
    }
    window.addEventListener('terminal:active-changed', onActiveChanged);
    return () => window.removeEventListener('terminal:active-changed', onActiveChanged);
  }, []);

  const handleCollapse = useCallback(() => {
    setTerminalCollapsed(true);
  }, []);

  const basePath = `/w/${params.workspace}`;
  const isProjectRoute = pathname.startsWith(`${basePath}/projects/`);
  const isDocsRoute = pathname.startsWith(`${basePath}/docs`);

  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: params.project ?? '' },
    { enabled: isProjectRoute && !!workspace && !!params.project },
  );

  const isContainerEnabled = workspace?.containerEnabled ?? false;

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

    const groupKey = `project:${params.workspace}:${projectSlug}`;

    function makeRepoEntry(
      repoPath: string,
      mode: 'host' | 'container' | undefined,
    ): TerminalDropdownGroup['entries'][number] {
      const dirName = repoPath.split('/').filter(Boolean).pop() ?? repoPath;
      const isContainer = mode === 'container';
      return {
        id: `${isContainer ? 'container:' : ''}repo:${repoPath}`,
        label: isContainer ? `${dirName} (Container)` : dirName,
        tooltip: repoPath,
        scope: {
          scopeType: 'project',
          scopeLabel: `claude: ${dirName}`,
          workingDir: repoPath,
          command: buildClaudeCommand({
            systemPrompt,
            additionalDirs: projectDir ? [projectDir] : undefined,
            dangerouslySkipPermissions: isContainer,
          }),
          groupKey,
          workspaceSlug: params.workspace,
          containerMode: mode,
        },
        icon: isContainer ? RiBox3Line : isContainerEnabled ? RiComputerLine : RiGitRepositoryLine,
      };
    }

    function makeAllReposEntry(
      mode: 'host' | 'container' | undefined,
    ): TerminalDropdownGroup['entries'][number] {
      const isContainer = mode === 'container';
      return {
        id: `${isContainer ? 'container:' : ''}repo:all`,
        label: isContainer ? 'All Repos (Container)' : 'All Repos',
        tooltip: repos.join(', '),
        scope: {
          scopeType: 'project',
          scopeLabel: 'claude: all repos',
          workingDir: repos[0],
          command: buildClaudeCommand({
            systemPrompt,
            additionalDirs: [
              ...(projectDir ? [projectDir] : []),
              ...repos.slice(1),
            ],
            dangerouslySkipPermissions: isContainer,
          }),
          groupKey,
          workspaceSlug: params.workspace,
          containerMode: mode,
        },
        icon: isContainer ? RiBox3Line : isContainerEnabled ? RiComputerLine : RiGitRepositoryFill,
      };
    }

    const hostMode = isContainerEnabled ? ('host' as const) : undefined;
    const entries: TerminalDropdownGroup['entries'] = [];

    for (const repoPath of repos) {
      entries.push(makeRepoEntry(repoPath, hostMode));
      if (isContainerEnabled) {
        entries.push(makeRepoEntry(repoPath, 'container'));
      }
    }

    if (repos.length > 1) {
      entries.push(makeAllReposEntry(hostMode));
      if (isContainerEnabled) {
        entries.push(makeAllReposEntry('container'));
      }
    }

    return [{ label: 'Claude in Repos', entries }];
  }, [isProjectRoute, workspace, project, params.project, params.workspace, isContainerEnabled]);

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

  return (
    <EventsProvider workspaceSlug={params.workspace}>
      <AutoInvalidation />
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {!isProjectRoute && (
          <nav className="border-b border-border" aria-label="Workspace sections">
            <div className={cn('flex', isMobile ? 'px-3' : 'px-6')}>
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
          centerContent={
            <BottomTerminalSplit
              isMobile={isMobile}
              extraDropdownGroups={allDropdownGroups}
              containerEnabled={isContainerEnabled}
            >
              <div
                className={cn(
                  'flex min-h-0 flex-1 flex-col overflow-hidden',
                  !isDocsRoute && (isMobile ? 'px-2' : 'px-6'),
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
    </EventsProvider>
  );
}

function AutoInvalidation() {
  useTaskAutoInvalidation();
  useQuestionAutoInvalidation();
  return null;
}
