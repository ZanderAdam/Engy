'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { FileListPanel } from './file-list-panel';
import { DiffViewerPanel } from './diff-viewer-panel';
import { DiffHeader } from './diff-header';
import { ViewModeTabs } from './view-mode-tabs';
import { CommitList } from './commit-list';
import { RepoSelector } from './repo-selector';
import { ReviewActions } from './review-actions';
import { useDiffComments } from './use-diff-comments';
import type { ChangedFile, ViewMode, DiffViewMode } from './types';

interface DiffsPageProps {
  workspaceSlug: string;
}

export function DiffsPage({ workspaceSlug }: DiffsPageProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('latest');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState('origin/main');
  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(null);

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

  const handleRepoChange = (repo: string) => {
    setUserSelectedRepo(repo);
    setSelectedFile(null);
    setSelectedCommit(null);
  };

  const handleDiffViewModeChange = (mode: DiffViewMode) => {
    setDiffViewMode(mode);
    setSelectedFile(null);
    setSelectedCommit(null);
  };

  // Latest changes data
  const {
    data: statusData,
    isLoading: isStatusLoading,
    refetch: refetchStatus,
  } = trpc.diff.getStatus.useQuery(
    { repoDir: selectedRepo! },
    { enabled: !!selectedRepo && diffViewMode === 'latest' },
  );

  // Commit history data
  const { data: logData, isLoading: isLogLoading } = trpc.diff.getLog.useQuery(
    { repoDir: selectedRepo! },
    { enabled: !!selectedRepo && diffViewMode === 'history' },
  );

  // Commit diff data
  const { data: commitDiffData } = trpc.diff.getCommitDiff.useQuery(
    { repoDir: selectedRepo!, commitHash: selectedCommit! },
    { enabled: !!selectedRepo && !!selectedCommit && diffViewMode === 'history' },
  );

  // Branch diff data
  const {
    data: branchDiffData,
    isLoading: isBranchLoading,
    error: branchError,
  } = trpc.diff.getBranchDiff.useQuery(
    { repoDir: selectedRepo!, base: baseBranch },
    { enabled: !!selectedRepo && diffViewMode === 'branch' && baseBranch.length > 0, retry: false },
  );

  // Comments
  const { diffComments, commentsForFile, addLineComment, replyToThread, resolve, remove } =
    useDiffComments(selectedRepo);

  // Resolve files list based on view mode
  const files: ChangedFile[] = useMemo(() => {
    if (diffViewMode === 'latest') return statusData?.files ?? [];
    if (diffViewMode === 'history' && commitDiffData) {
      return commitDiffData.files.map((f) => ({ ...f, staged: false }));
    }
    if (diffViewMode === 'branch' && branchDiffData) {
      return branchDiffData.files.map((f) => ({ ...f, staged: false }));
    }
    return [];
  }, [diffViewMode, statusData, commitDiffData, branchDiffData]);

  const selectedFileData = useMemo(
    () => files.find((f) => f.path === selectedFile),
    [files, selectedFile],
  );

  // File diff for selected file (latest + branch modes)
  const diffBase = diffViewMode === 'branch' ? baseBranch : undefined;
  const { data: fileDiffData } = trpc.diff.getFileDiff.useQuery(
    { repoDir: selectedRepo!, filePath: selectedFile!, base: diffBase, staged: selectedFileData?.staged },
    {
      enabled:
        !!selectedRepo &&
        !!selectedFile &&
        !!selectedFileData &&
        (diffViewMode === 'latest' || diffViewMode === 'branch'),
    },
  );

  // Per-file diff for history mode (commit selected + file selected)
  const { data: commitFileDiffData } = trpc.diff.getFileDiff.useQuery(
    { repoDir: selectedRepo!, filePath: selectedFile!, base: `${selectedCommit}~1` },
    {
      enabled:
        !!selectedRepo &&
        !!selectedFile &&
        !!selectedCommit &&
        diffViewMode === 'history',
    },
  );

  // Resolve current diff string
  const currentDiff = useMemo(() => {
    if (diffViewMode === 'history') {
      return commitFileDiffData?.diff ?? '';
    }
    return fileDiffData?.diff ?? '';
  }, [diffViewMode, commitFileDiffData, fileDiffData]);

  const fileComments = useMemo(
    () => (selectedFile ? commentsForFile(selectedFile) : []),
    [selectedFile, commentsForFile],
  );

  const isFileListLoading =
    (diffViewMode === 'latest' && isStatusLoading) ||
    (diffViewMode === 'history' && isLogLoading) ||
    (diffViewMode === 'branch' && isBranchLoading);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Top bar: view mode tabs + repo selector + review actions */}
      <div className="flex items-center justify-between border-b border-border">
        <div className="flex items-center">
          <ViewModeTabs value={diffViewMode} onChange={handleDiffViewModeChange} />
          <RepoSelector
            repos={allRepos}
            selectedRepo={selectedRepo ?? ''}
            onSelectRepo={handleRepoChange}
          />
        </div>
        <div className="px-3">
          <ReviewActions repoDir={selectedRepo} diffComments={diffComments} />
        </div>
      </div>

      {/* Branch diff: base branch input */}
      {diffViewMode === 'branch' && (
        <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <span className="text-xs text-muted-foreground">Base:</span>
          <input
            type="text"
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            className="h-6 border border-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:border-ring"
            placeholder="origin/main"
          />
          {branchError && (
            <span className="text-xs text-destructive">
              {branchError.message.replace(/^.*Invalid base ref/, 'Invalid ref')}
            </span>
          )}
        </div>
      )}

      {/* Main content: file list + diff viewer */}
      <div className="flex flex-1 min-h-0">
        {/* Left panel: file list or commit list */}
        <div className="flex w-[280px] flex-shrink-0 flex-col border-r border-border">
          {diffViewMode === 'history' ? (
            <div className="flex flex-1 min-h-0 flex-col">
              <div className={cn(
                'overflow-auto',
                selectedCommit && commitDiffData ? 'max-h-[25%]' : 'flex-1',
              )}>
                <CommitList
                  commits={logData?.commits ?? []}
                  selectedHash={selectedCommit}
                  onSelectCommit={(hash) => {
                    setSelectedCommit(hash);
                    setSelectedFile(null);
                  }}
                  isLoading={isLogLoading}
                />
              </div>
              {selectedCommit && commitDiffData && (
                <div className="flex-1 min-h-0 border-t border-border overflow-auto">
                  <FileListPanel
                    files={files}
                    selectedFile={selectedFile}
                    onSelectFile={setSelectedFile}
                    onRefresh={() => {}}
                    isLoading={false}
                  />
                </div>
              )}
            </div>
          ) : (
            <FileListPanel
              files={files}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              onRefresh={() => {
                if (diffViewMode === 'latest') refetchStatus();
              }}
              isLoading={isFileListLoading}
            />
          )}
        </div>

        {/* Right panel: diff viewer */}
        <div className="flex flex-1 min-w-0 flex-col">
          {allRepos.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                No repositories configured for this workspace
              </p>
            </div>
          ) : !selectedFile ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">
                {diffViewMode === 'history' && !selectedCommit
                  ? 'Select a commit to view its changes'
                  : 'Select a file to view its diff'}
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col min-h-0">
              {selectedFileData && (
                <DiffHeader
                  filePath={selectedFile}
                  status={selectedFileData.status}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                />
              )}
              <div className="flex-1 overflow-auto">
                <DiffViewerPanel
                  diff={currentDiff}
                  viewMode={viewMode}
                  filePath={selectedFile}
                  fileComments={fileComments}
                  onAddComment={(lineNumber, codeLine, changeKey, text) =>
                    addLineComment(selectedFile!, lineNumber, codeLine, changeKey, text)
                  }
                  onReply={replyToThread}
                  onResolve={resolve}
                  onDelete={remove}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
