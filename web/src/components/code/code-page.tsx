'use client';

import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { DynamicMonacoCodeEditor } from '@/components/editor/dynamic-monaco-editors';
import { useAutoSave } from '@/components/diff/use-auto-save';
import { RepoSelector } from '@/components/diff/repo-selector';
import { RepoFileTree } from '@/components/code/repo-file-tree';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';

interface CodePageProps {
  workspaceSlug: string;
  projectSlug?: string;
}

interface CodePageState {
  repo: string | null;
  file: string | null;
}

function codeStateKey(workspaceSlug: string, projectSlug: string | undefined): string {
  return `code-page:${workspaceSlug}:${projectSlug ?? ''}`;
}

function loadCodeState(workspaceSlug: string, projectSlug: string | undefined): CodePageState {
  try {
    const raw = localStorage.getItem(codeStateKey(workspaceSlug, projectSlug));
    if (!raw) return { repo: null, file: null };
    return JSON.parse(raw) as CodePageState;
  } catch {
    return { repo: null, file: null };
  }
}

function saveCodeState(
  workspaceSlug: string,
  projectSlug: string | undefined,
  state: CodePageState,
): void {
  try {
    localStorage.setItem(codeStateKey(workspaceSlug, projectSlug), JSON.stringify(state));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function CodePage({ workspaceSlug, projectSlug }: CodePageProps) {
  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(
    () => loadCodeState(workspaceSlug, projectSlug).repo,
  );
  // Path relative to the effective root
  const [selectedFile, setSelectedFile] = useState<string | null>(
    () => loadCodeState(workspaceSlug, projectSlug).file,
  );

  // Persist both fields together whenever either changes.
  useEffect(() => {
    saveCodeState(workspaceSlug, projectSlug, { repo: userSelectedRepo, file: selectedFile });
  }, [userSelectedRepo, selectedFile, workspaceSlug, projectSlug]);

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: taskGroups } = trpc.taskGroup.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    { enabled: !!workspace },
  );
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspace && !!projectSlug },
  );

  const { repoMap: worktreeRepoMap } = useProjectWorktreeMap({ projectId: project?.id });

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

  // Clear the open file when the effective root changes — the remembered relative
  // path may not exist under the new root. Uses the "set state during render"
  // pattern per React's set-state-in-effect rule.
  const [prevEffectiveRoot, setPrevEffectiveRoot] = useState<string | null>(effectiveRoot);
  if (effectiveRoot !== prevEffectiveRoot) {
    setPrevEffectiveRoot(effectiveRoot);
    setSelectedFile(null);
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

  const { status: saveStatus, save } = useAutoSave(
    selectedRepo,
    selectedFile,
    overrideWorktreePath,
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
        <div className="flex shrink-0 items-center gap-2">
          <RepoSelector
            repos={allRepos}
            selectedRepo={selectedRepo ?? ''}
            onSelectRepo={(repo) => {
              setUserSelectedRepo(repo);
              setSelectedFile(null);
            }}
          />
          {selectedFile && (
            <span className="truncate font-mono text-xs text-muted-foreground">{selectedFile}</span>
          )}
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
              onSelectFile={(relPath) => setSelectedFile(relPath || null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-xs text-muted-foreground">No repository selected</p>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {!selectedFile ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground">Select a file to edit</p>
            </div>
          ) : (
            <DynamicMonacoCodeEditor
              content={fileData?.content ?? ''}
              filePath={selectedFile}
              onChange={(value) => save(value)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
