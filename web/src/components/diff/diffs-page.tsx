'use client';

import { useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { DynamicMonacoCodeEditor } from '@/components/editor/dynamic-monaco-editors';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { useIsMobile } from '@/hooks/use-mobile';
import { FileListPanel } from './file-list-panel';
import { DiffViewerPanel } from './diff-viewer-panel';
import { DiffHeader } from './diff-header';
import { ViewModeTabs } from './view-mode-tabs';
import { CommitList } from './commit-list';
import { RepoSelector } from './repo-selector';
import { SessionSelector } from './session-selector';
import { ReviewActions } from './review-actions';
import { useDiffComments, extractFilePathFromDocPath } from './use-diff-comments';
import { useAutoSave } from './use-auto-save';
import type { ChangedFile, ViewMode, DiffViewMode, EditorMode } from './types';

const SIDEBAR_CONFIG = {
  defaultWidth: 280,
  minWidth: 180,
  maxWidth: 450,
  storageKey: 'engy-diffs-sidebar-width',
} as const;

interface DiffsPageProps {
  workspaceSlug: string;
}

export function DiffsPage({ workspaceSlug }: DiffsPageProps) {
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [prevIsMobile, setPrevIsMobile] = useState(false);
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile);
    setSidebarCollapsed(isMobile);
  }

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('latest');
  const [editorMode, setEditorMode] = useState<EditorMode>('diff');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState('origin/main');
  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const handleSessionChange = (sessionId: string | null) => {
    setSelectedSessionId(sessionId);
    setSelectedFile(null);
    setSelectedCommit(null);
  };

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
    setEditorMode('diff');
    setSelectedFile(null);
    setSelectedCommit(null);
  };

  // Latest changes data
  const {
    data: statusData,
    isLoading: isStatusLoading,
    refetch: refetchStatus,
  } = trpc.diff.getStatus.useQuery(
    { repoDir: selectedRepo!, sessionId: selectedSessionId ?? undefined },
    { enabled: !!selectedRepo && diffViewMode === 'latest' },
  );

  // Commit history data
  const { data: logData, isLoading: isLogLoading } = trpc.diff.getLog.useQuery(
    { repoDir: selectedRepo!, sessionId: selectedSessionId ?? undefined },
    { enabled: !!selectedRepo && diffViewMode === 'history' },
  );

  // Commit diff data (for file list)
  const { data: commitDiffData } = trpc.diff.getCommitDiff.useQuery(
    { repoDir: selectedRepo!, commitHash: selectedCommit!, sessionId: selectedSessionId ?? undefined },
    { enabled: !!selectedRepo && !!selectedCommit && diffViewMode === 'history' },
  );

  // Branch diff data (for file list)
  const {
    data: branchDiffData,
    isLoading: isBranchLoading,
    error: branchError,
  } = trpc.diff.getBranchDiff.useQuery(
    { repoDir: selectedRepo!, base: baseBranch, sessionId: selectedSessionId ?? undefined },
    { enabled: !!selectedRepo && diffViewMode === 'branch' && baseBranch.length > 0, retry: false },
  );

  // Resolve the original ref based on view mode
  const originalRef = useMemo(() => {
    if (diffViewMode === 'latest') return 'HEAD';
    if (diffViewMode === 'history' && selectedCommit) return `${selectedCommit}~1`;
    if (diffViewMode === 'branch') return baseBranch;
    return undefined;
  }, [diffViewMode, selectedCommit, baseBranch]);

  // Resolve the modified ref (undefined = working tree)
  const modifiedRef = useMemo(() => {
    if (diffViewMode === 'history' && selectedCommit) return selectedCommit;
    return undefined; // working tree for latest + branch
  }, [diffViewMode, selectedCommit]);

  // Comments
  const { diffComments, commentsForFile, addLineComment, replyToThread, resolve, remove } =
    useDiffComments(selectedRepo);

  const fileComments = useMemo(
    () => (selectedFile ? commentsForFile(selectedFile) : []),
    [selectedFile, commentsForFile],
  );

  const handleAddComment = (lineNumber: number, side: 'modified' | 'original', text: string) => {
    if (selectedFile) addLineComment(selectedFile, lineNumber, '', text, side);
  };

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

  const sessionId = selectedSessionId ?? undefined;

  // File content: original
  const { data: originalData } = trpc.file.read.useQuery(
    { repoDir: selectedRepo!, filePath: selectedFile!, ref: originalRef, sessionId },
    { enabled: !!selectedRepo && !!selectedFile && !!originalRef, retry: false },
  );

  // File content: modified
  const { data: modifiedData } = trpc.file.read.useQuery(
    { repoDir: selectedRepo!, filePath: selectedFile!, ref: modifiedRef, sessionId },
    { enabled: !!selectedRepo && !!selectedFile, retry: false },
  );

  // Resolve file content (handle added/deleted files)
  const originalContent = useMemo(() => {
    if (selectedFileData?.status === 'added') return '';
    return originalData?.content ?? '';
  }, [originalData, selectedFileData]);

  const modifiedContent = useMemo(() => {
    if (selectedFileData?.status === 'deleted') return '';
    return modifiedData?.content ?? '';
  }, [modifiedData, selectedFileData]);

  // Auto-save
  const { status: saveStatus, save } = useAutoSave(
    diffViewMode === 'latest' ? selectedRepo : null,
    selectedFile,
  );

  const isFileListLoading =
    (diffViewMode === 'latest' && isStatusLoading) ||
    (diffViewMode === 'history' && isLogLoading) ||
    (diffViewMode === 'branch' && isBranchLoading);

  // Filter comments to current diff files + build per-file unresolved counts
  const { currentFileComments, fileCommentCounts } = useMemo(() => {
    if (!selectedRepo) return { currentFileComments: [], fileCommentCounts: new Map<string, number>() };
    const filePaths = new Set(files.map((f) => f.path));
    const filtered: typeof diffComments = [];
    const counts = new Map<string, number>();

    for (const c of diffComments) {
      const filePath = extractFilePathFromDocPath(c.documentPath, selectedRepo);
      if (!filePath || !filePaths.has(filePath)) continue;
      filtered.push(c);
      if (!c.resolved) {
        counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
      }
    }

    return { currentFileComments: filtered, fileCommentCounts: counts };
  }, [diffComments, files, selectedRepo]);

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
          <SessionSelector
            selectedSessionId={selectedSessionId}
            onSessionChange={handleSessionChange}
          />
        </div>
        <div className="px-3">
          <ReviewActions repoDir={selectedRepo} diffComments={currentFileComments} />
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
      <ThreePanelLayout
        className="flex-1 min-h-0"
        left={SIDEBAR_CONFIG}
        isMobile={isMobile}
        leftCollapsed={sidebarCollapsed}
        onLeftCollapsedChange={setSidebarCollapsed}
        leftContent={
          diffViewMode === 'history' ? (
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
                    commentCounts={fileCommentCounts}
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
              commentCounts={fileCommentCounts}
            />
          )
        }
        centerContent={
          allRepos.length === 0 ? (
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
                  editorMode={editorMode}
                  onEditorModeChange={setEditorMode}
                  diffViewMode={diffViewMode}
                  saveStatus={saveStatus}
                />
              )}
              <div className="flex-1 min-h-0">
                {editorMode === 'edit' && diffViewMode === 'latest' ? (
                  <DynamicMonacoCodeEditor
                    content={modifiedContent}
                    filePath={selectedFile}
                    onChange={save}
                  />
                ) : (
                  <DiffViewerPanel
                    originalContent={originalContent}
                    modifiedContent={modifiedContent}
                    viewMode={viewMode}
                    filePath={selectedFile}
                    onChange={diffViewMode === 'latest' ? save : undefined}
                    fileComments={fileComments}
                    onAddComment={handleAddComment}
                    onReply={replyToThread}
                    onResolve={resolve}
                    onDelete={remove}
                  />
                )}
              </div>
            </div>
          )
        }
      />
    </div>
  );
}
