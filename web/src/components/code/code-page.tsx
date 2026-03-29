'use client';

import { useCallback, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { DynamicMonacoCodeEditor } from '@/components/editor/dynamic-monaco-editors';
import { useAutoSave } from '@/components/diff/use-auto-save';
import { RepoSelector } from '@/components/diff/repo-selector';
import { LazyFileTree } from '@/components/diff/file-tree';

interface CodePageProps {
  workspaceSlug: string;
}

export function CodePage({ workspaceSlug }: CodePageProps) {
  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: taskGroups } = trpc.taskGroup.list.useQuery({});

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

  const trpcUtils = trpc.useUtils();

  const listDir = useCallback(
    async (dirPath: string) => {
      return trpcUtils.file.listDir.fetch({ dirPath });
    },
    [trpcUtils],
  );

  const searchFiles = useCallback(
    async (query: string) => {
      if (!selectedRepo) return [];
      const result = await trpcUtils.dir.searchRepoFiles.fetch({
        dirs: [selectedRepo],
        query,
        limit: 50,
      });
      return result.results;
    },
    [trpcUtils, selectedRepo],
  );

  // File path for read is relative to repo, but LazyFileTree gives absolute paths
  const relativeSelectedFile = useMemo(() => {
    if (!selectedFile || !selectedRepo) return null;
    return selectedFile.startsWith(selectedRepo)
      ? selectedFile.slice(selectedRepo.length + 1)
      : selectedFile;
  }, [selectedFile, selectedRepo]);

  const { data: fileData } = trpc.file.read.useQuery(
    { repoDir: selectedRepo!, filePath: relativeSelectedFile! },
    { enabled: !!selectedRepo && !!relativeSelectedFile, retry: false },
  );

  const { status: saveStatus, save } = useAutoSave(
    selectedRepo,
    relativeSelectedFile,
  );

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <RepoSelector
          repos={allRepos}
          selectedRepo={selectedRepo ?? ''}
          onSelectRepo={(repo) => {
            setUserSelectedRepo(repo);
            setSelectedFile(null);
          }}
        />
        {relativeSelectedFile && (
          <span className="truncate font-mono text-xs text-muted-foreground">
            {relativeSelectedFile}
          </span>
        )}
        <div className="ml-auto">
          {saveStatus !== 'idle' && (
            <span className="text-[10px] text-muted-foreground">
              {saveStatus === 'saving' ? 'Saving...' : saveStatus === 'saved' ? 'Saved' : 'Error'}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 min-h-0">
        <div className="w-[280px] flex-shrink-0 border-r border-border">
          {selectedRepo ? (
            <LazyFileTree
              rootDir={selectedRepo}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              listDir={listDir}
              searchFiles={searchFiles}
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
