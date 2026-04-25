'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useVirtualSearchParams } from '@/components/tabs/tab-context';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRecentDirs } from '@/hooks/use-recent-dirs';
import { ThreePanelLayout, type ShortcutDef } from '@/components/layout/three-panel-layout';
import { TerminalManager } from '@/components/terminal/terminal-manager';
import type { TerminalScope } from '@/components/terminal/types';
import { DirFileTree, DirFileEditor, DirEmptyState } from '@/components/dir-browser';
import { DirDiffPanel } from '@/components/diff/dir-diff-panel';
import { RiFolderOpenLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';

const LEFT_PANEL_CONFIG = {
  defaultWidth: 256,
  minWidth: 180,
  maxWidth: 384,
  storageKey: 'engy-open-sidebar-width',
} as const;

const TERMINAL_CONFIG = {
  defaultWidth: 480,
  minWidth: 240,
  maxWidth: 900,
  storageKey: 'engy-open-terminal-width',
} as const;

const TERMINAL_SHORTCUT: ShortcutDef = { ctrl: true, key: '`' };

export default function OpenPage() {
  return (
    <Suspense fallback={null}>
      <OpenPageOuter />
    </Suspense>
  );
}

function OpenPageOuter() {
  const searchParams = useVirtualSearchParams();
  const dirPath = searchParams.get('path') ?? '';

  if (!dirPath) {
    return (
      <div className="flex flex-1 min-h-0 flex-col items-center justify-center gap-3">
        <RiFolderOpenLine className="size-10 text-muted-foreground/50" />
        <p className="text-sm text-muted-foreground">No directory selected.</p>
        <p className="text-xs text-muted-foreground">
          Go back to the home page and open a directory.
        </p>
      </div>
    );
  }

  return <OpenPageInner key={dirPath} dirPath={dirPath} />;
}

type CenterMode = 'editor' | 'diffs';

function OpenPageInner({ dirPath }: { dirPath: string }) {
  const isMobile = useIsMobile();
  const { addDir } = useRecentDirs();

  useEffect(() => {
    if (dirPath) addDir(dirPath);
  }, [dirPath, addDir]);

  const [selectedRelPath, setSelectedRelPath] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [prevIsMobile, setPrevIsMobile] = useState(false);
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile);
    setSidebarCollapsed(isMobile);
  }
  const [terminalCollapsed, setTerminalCollapsed] = useState(false);
  const [centerMode, setCenterMode] = useState<CenterMode>('editor');

  // Check if the directory is a git repo
  const { data: gitStatus } = trpc.diff.getStatus.useQuery(
    { repoDir: dirPath },
    { retry: false },
  );
  const isGitRepo = !!gitStatus;

  const handleSelectFile = useCallback(
    (relPath: string) => {
      setSelectedRelPath(relPath);
      setCenterMode('editor');
      if (isMobile) setSidebarCollapsed(true);
    },
    [isMobile],
  );

  const terminalScope = useMemo<TerminalScope>(
    () => ({
      scopeType: 'dir',
      scopeLabel: dirPath,
      workingDir: dirPath,
      groupKey: `dir:${dirPath}`,
      workspaceSlug: '',
    }),
    [dirPath],
  );

  const handleTerminalCollapse = useCallback(() => {
    setTerminalCollapsed(true);
  }, []);

  const centerContent = useMemo(() => {
    if (centerMode === 'diffs' && isGitRepo) {
      return <DirDiffPanel dirPath={dirPath} />;
    }
    if (selectedRelPath) {
      return <DirFileEditor dirPath={dirPath} relPath={selectedRelPath} />;
    }
    return <DirEmptyState />;
  }, [centerMode, isGitRepo, dirPath, selectedRelPath]);

  return (
    <ThreePanelLayout
      className="flex-1 min-h-0"
      left={LEFT_PANEL_CONFIG}
      right={TERMINAL_CONFIG}
      leftCollapsed={sidebarCollapsed}
      onLeftCollapsedChange={setSidebarCollapsed}
      rightCollapsed={terminalCollapsed}
      onRightCollapsedChange={setTerminalCollapsed}
      rightShortcut={TERMINAL_SHORTCUT}
      isMobile={isMobile}
      leftContent={
        <div className="flex flex-1 min-h-0 flex-col">
          {isGitRepo && (
            <div className="flex border-b border-border">
              <button
                onClick={() => setCenterMode('editor')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                  centerMode === 'editor' && 'text-foreground bg-muted/50',
                )}
              >
                Files
              </button>
              <button
                onClick={() => setCenterMode('diffs')}
                className={cn(
                  'flex-1 px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                  centerMode === 'diffs' && 'text-foreground bg-muted/50',
                )}
              >
                Diffs
              </button>
            </div>
          )}
          <DirFileTree
            dirPath={dirPath}
            selectedFile={selectedRelPath}
            onSelectFile={handleSelectFile}
          />
        </div>
      }
      centerContent={centerContent}
      rightContent={
        <div className="flex flex-1 min-h-0 flex-col bg-[#0a0a0a]">
          <TerminalManager
            onCollapse={handleTerminalCollapse}
            defaultScope={terminalScope}
          />
        </div>
      }
    />
  );
}
