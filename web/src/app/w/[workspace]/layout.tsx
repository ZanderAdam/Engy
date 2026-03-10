'use client';

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, usePathname } from 'next/navigation';
import Link from 'next/link';
import { RiGitRepositoryLine, RiGitRepositoryFill } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { ThreePanelLayout, type ShortcutDef } from '@/components/layout/three-panel-layout';
import { TerminalPanel } from '@/components/terminal/terminal-panel';
import type { TerminalDropdownGroup } from '@/components/terminal/types';
import { FileChangeProvider } from '@/contexts/file-change-context';

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

function shellEscape(s: string): string {
  return s.replace(/'/g, "'\\''");
}

export default function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ workspace: string; project?: string }>();
  const pathname = usePathname();
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

  const extraDropdownGroups = useMemo<TerminalDropdownGroup[] | undefined>(() => {
    if (!isProjectRoute || !workspace) return undefined;
    const repos = (workspace.repos as string[]) ?? [];
    if (repos.length === 0) return undefined;

    const projectSlug = params.project;
    const projectDir =
      projectSlug && workspace.resolvedDir
        ? `${workspace.resolvedDir}/projects/${projectSlug}`
        : undefined;
    const addProjectDir = projectDir ? ` --add-dir '${shellEscape(projectDir)}'` : '';

    const entries: TerminalDropdownGroup['entries'] = repos.map((repoPath) => {
      const dirName = repoPath.split('/').filter(Boolean).pop() ?? repoPath;
      return {
        id: `repo:${repoPath}`,
        label: dirName,
        tooltip: repoPath,
        scope: {
          scopeType: 'project',
          scopeLabel: `claude: ${dirName}`,
          workingDir: repoPath,
          command: `claude${addProjectDir}`,
        },
        icon: RiGitRepositoryLine,
      };
    });

    if (repos.length > 1) {
      const addDirFlags = [
        addProjectDir,
        ...repos.slice(1).map((d) => ` --add-dir '${shellEscape(d)}'`),
      ].filter(Boolean).join('');
      entries.push({
        id: 'repo:all',
        label: 'All Repos',
        tooltip: repos.join(', '),
        scope: {
          scopeType: 'project',
          scopeLabel: 'claude: all repos',
          workingDir: repos[0],
          command: `claude${addDirFlags}`,
        },
        icon: RiGitRepositoryFill,
      });
    }

    return [{ label: 'Claude in Repos', entries }];
  }, [isProjectRoute, workspace, params.project, pathname]);

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
        <Link href="/" className="mt-2 text-xs text-primary underline">
          Back to home
        </Link>
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
    <FileChangeProvider workspaceSlug={params.workspace}>
      <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
        {!isProjectRoute && (
          <nav className="border-b border-border" aria-label="Workspace sections">
            <div className={cn('flex', isMobile ? 'px-3' : 'px-6')}>
              {tabs.map((tab) => (
                <Link
                  key={tab.segment}
                  href={tabHref(tab.segment)}
                  className={cn(
                    'relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                    isActive(tab.segment) &&
                      'text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground',
                  )}
                >
                  {tab.label}
                </Link>
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
            <div
              className={cn(
                'flex min-h-0 flex-1 flex-col overflow-hidden',
                !isDocsRoute && (isMobile ? 'px-2' : 'px-6'),
              )}
            >
              {children}
            </div>
          }
          rightContent={
            <TerminalPanel onCollapse={handleCollapse} extraDropdownGroups={extraDropdownGroups} />
          }
        />
      </div>
    </FileChangeProvider>
  );
}
