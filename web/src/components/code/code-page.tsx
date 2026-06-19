'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RiFileSearchLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { DynamicMonacoCodeEditor } from '@/components/editor/dynamic-monaco-editors';
import { useAutoSave } from '@/components/diff/use-auto-save';
import { RepoSelector } from '@/components/diff/repo-selector';
import { RepoFileTree } from '@/components/code/repo-file-tree';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import { Button } from '@/components/ui/button';
import { getLanguageFromPath } from '@/components/editor/language-map';
import type { CursorPosition } from '@/components/editor/monaco-code-editor';
import { EditorTabs } from './editor-tabs';
import { EditorStatusBar } from './editor-status-bar';
import { QuickOpen } from './quick-open';
import {
  canGoBack,
  canGoForward,
  closeTab,
  emptyTabsState,
  navigateBack,
  navigateForward,
  openTab,
  type TabsState,
} from './open-tabs';
import {
  codeStateKey,
  parseCodeState,
  serializeCodeState,
  type CodePageState,
} from './code-page-state';

interface CodePageProps {
  workspaceSlug: string;
  projectSlug?: string;
}

function loadCodeState(workspaceSlug: string, projectSlug: string | undefined): CodePageState {
  try {
    return parseCodeState(localStorage.getItem(codeStateKey(workspaceSlug, projectSlug)));
  } catch {
    return parseCodeState(null);
  }
}

export function CodePage({ workspaceSlug, projectSlug }: CodePageProps) {
  const [initialState] = useState(() => loadCodeState(workspaceSlug, projectSlug));

  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(initialState.repo);
  const [tabs, setTabs] = useState<TabsState>(() => ({
    tabs: initialState.tabs,
    active: initialState.active,
    history: initialState.active ? [initialState.active] : [],
    historyIndex: initialState.active ? 0 : -1,
  }));
  const [wordWrap, setWordWrap] = useState(initialState.wordWrap);
  const [minimap, setMinimap] = useState(initialState.minimap);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [cursor, setCursor] = useState<CursorPosition | null>(null);

  const selectedFile = tabs.active;

  // Persist repo, open tabs and view prefs together whenever any change.
  useEffect(() => {
    try {
      localStorage.setItem(
        codeStateKey(workspaceSlug, projectSlug),
        serializeCodeState({
          repo: userSelectedRepo,
          tabs: tabs.tabs,
          active: tabs.active,
          wordWrap,
          minimap,
        }),
      );
    } catch {
      // localStorage may be full or unavailable
    }
  }, [userSelectedRepo, tabs, wordWrap, minimap, workspaceSlug, projectSlug]);

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: taskGroups } = trpc.taskGroup.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

  const { repoMap: worktreeRepoMap } = useProjectWorktreeMap({
    projectId: project?.id,
    combined: workspace?.combinedWorktrees,
  });

  const allRepos = useMemo(() => {
    const repoSet = new Set<string>();
    if (taskGroups) {
      for (const group of taskGroups) {
        const repos = group.repos as string[] | null;
        if (repos) repos.forEach((r) => repoSet.add(r));
      }
    }
    if (workspace) {
      const repos = workspace.repos as string[] | null;
      if (repos) repos.forEach((r) => repoSet.add(r));
      if (workspace.docsDir) repoSet.add(workspace.docsDir);
    }
    return [...repoSet];
  }, [workspace, taskGroups]);

  const selectedRepo = userSelectedRepo ?? (allRepos.length > 0 ? allRepos[0] : null);
  // The worktree-effective root for `selectedRepo`. If no worktree is materialized
  // for this repo on the active branch, falls back to the main path.
  const effectiveRoot = useMemo(() => {
    if (!selectedRepo) return null;
    return worktreeRepoMap.get(selectedRepo) ?? selectedRepo;
  }, [selectedRepo, worktreeRepoMap]);

  // Reset the open tabs when the effective root changes — the remembered relative
  // paths may not exist under the new root. Uses the "set state during render"
  // pattern per React's set-state-in-effect rule.
  const [prevEffectiveRoot, setPrevEffectiveRoot] = useState<string | null>(effectiveRoot);
  if (effectiveRoot !== prevEffectiveRoot) {
    setPrevEffectiveRoot(effectiveRoot);
    setTabs(emptyTabsState);
    setCursor(null);
  }

  // Pass repoDir = main repo (preserves identity), worktreePath = effectiveRoot
  // (only when it differs). Symmetric with the Diffs page.
  const overrideWorktreePath =
    selectedRepo && effectiveRoot && effectiveRoot !== selectedRepo ? effectiveRoot : undefined;

  const { data: fileData } = trpc.file.read.useQuery(
    {
      repoDir: selectedRepo!,
      filePath: selectedFile!,
      worktreePath: overrideWorktreePath,
    },
    { enabled: !!selectedRepo && !!selectedFile, retry: false },
  );

  const { status: saveStatus, save } = useAutoSave(selectedRepo, selectedFile, overrideWorktreePath);

  // The status bar cursor belongs to the previous file until Monaco emits a new
  // position; reset it on every tab switch so it never shows a stale Ln/Col.
  const [prevSelectedFile, setPrevSelectedFile] = useState<string | null>(selectedFile);
  if (selectedFile !== prevSelectedFile) {
    setPrevSelectedFile(selectedFile);
    setCursor(null);
  }

  const openFile = useCallback((relPath: string) => {
    if (!relPath) return;
    setTabs((state) => openTab(state, relPath));
  }, []);

  // Ctrl/Cmd+P opens the fuzzy file finder — only when a repo root is available
  // (otherwise QuickOpen can't render), and without stealing browser print
  // elsewhere on the route.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        if (!effectiveRoot) return;
        e.preventDefault();
        setQuickOpenOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [effectiveRoot]);

  const language = selectedFile ? getLanguageFromPath(selectedFile) : '';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
        <div className="flex shrink-0 items-center gap-2">
          <RepoSelector
            repos={allRepos}
            selectedRepo={selectedRepo ?? ''}
            onSelectRepo={(repo) => {
              setUserSelectedRepo(repo);
              setTabs(emptyTabsState);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs text-muted-foreground"
            disabled={!effectiveRoot}
            onClick={() => setQuickOpenOpen(true)}
          >
            <RiFileSearchLine className="size-3.5" />
            Go to File
            <kbd className="ml-1 hidden rounded-sm bg-muted px-1 text-[10px] sm:inline">⌘P</kbd>
          </Button>
        </div>
        <div className="ml-auto shrink-0">
          {saveStatus !== 'idle' && (
            <span className="text-[10px] text-muted-foreground">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-[280px] flex-shrink-0 border-r border-border">
          {effectiveRoot && selectedRepo ? (
            <RepoFileTree
              key={effectiveRoot}
              rootDir={effectiveRoot}
              repoDir={selectedRepo}
              worktreePath={overrideWorktreePath}
              selectedFile={selectedFile}
              onSelectFile={openFile}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground">No repository selected</p>
            </div>
          )}
        </div>

        <div className="flex flex-1 min-w-0 flex-col">
          {tabs.tabs.length > 0 && (
            <EditorTabs
              tabs={tabs.tabs}
              active={tabs.active}
              canGoBack={canGoBack(tabs)}
              canGoForward={canGoForward(tabs)}
              onSelect={openFile}
              onClose={(path) => setTabs((state) => closeTab(state, path))}
              onBack={() => setTabs(navigateBack)}
              onForward={() => setTabs(navigateForward)}
            />
          )}

          <div className="flex-1 min-h-0">
            {!selectedFile || !effectiveRoot ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground">Select a file to edit</p>
              </div>
            ) : (
              <DynamicMonacoCodeEditor
                content={fileData?.content ?? ''}
                filePath={selectedFile}
                repoRoot={effectiveRoot}
                wordWrap={wordWrap}
                minimap={minimap}
                onChange={(value) => save(value)}
                onCursorChange={setCursor}
              />
            )}
          </div>

          {selectedFile && (
            <EditorStatusBar
              language={language}
              cursor={cursor}
              wordWrap={wordWrap}
              minimap={minimap}
              onToggleWordWrap={() => setWordWrap((v) => !v)}
              onToggleMinimap={() => setMinimap((v) => !v)}
            />
          )}
        </div>
      </div>

      {effectiveRoot && (
        <QuickOpen
          open={quickOpenOpen}
          onOpenChange={setQuickOpenOpen}
          rootDir={effectiveRoot}
          onSelectFile={openFile}
        />
      )}
    </div>
  );
}
