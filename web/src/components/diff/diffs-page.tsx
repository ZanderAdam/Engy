'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { DynamicMonacoCodeEditor } from '@/components/editor/dynamic-monaco-editors';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { useIsMobile } from '@/hooks/use-mobile';
import { FileListPanel } from './file-list-panel';
import { DiffViewerPanel } from './diff-viewer-panel';
import { ImageDiffView } from './image-diff-view';
import { DiffHeader } from './diff-header';
import { NonTextFileView } from '@/components/editor/non-text-file-view';
import { fileKind } from '@/lib/file-types';
import { ViewModeTabs } from './view-mode-tabs';
import { CommitList } from './commit-list';
import { RepoSelector } from './repo-selector';
import { WorktreeSelector } from './worktree-selector';
import type { WorktreeSelection } from './worktree-selector';
import { ReviewActions } from './review-actions';
import { GithubCommentTriage } from './github-comment-triage';
import { useDiffComments, extractFilePathFromDocPath } from './use-diff-comments';
import { resolveFileReadError } from './diff-content-state';
import { useAutoSave } from './use-auto-save';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import { RiGitBranchLine } from '@remixicon/react';
import { useOnServerEvent } from '@/contexts/events-context';
import type { ChangedFile, ViewMode, DiffViewMode, EditorMode } from './types';

const SIDEBAR_CONFIG = {
  defaultWidth: 280,
  minWidth: 180,
  maxWidth: 450,
  storageKey: 'engy-diffs-sidebar-width',
} as const;

interface DiffsPageProps {
  workspaceSlug: string;
  projectSlug: string;
}

export function DiffsPage({ workspaceSlug, projectSlug }: DiffsPageProps) {
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
  const [userSelectedWorktree, setUserSelectedWorktree] = useState<WorktreeSelection>(null);

  const handleUserWorktreeChange = (worktree: WorktreeSelection) => {
    setUserSelectedWorktree(worktree);
    setSelectedFile(null);
    setSelectedCommit(null);
  };

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspace?.id ?? 0, slug: projectSlug },
    { enabled: !!workspace },
  );

  const { branch: projectWorktreeBranch, repoMap: projectRepoMap } = useProjectWorktreeMap({
    projectId: project?.id,
    combined: workspace?.combinedWorktrees,
  });

  // When a project-level worktree activates, drop any local per-repo worktree
  // selection so clearing `?wt` later doesn't resurrect a stale Coder pick.
  // Using the "set state during render" pattern (vs. useEffect) per React's
  // recommendation for state synced to props.
  const [prevProjectWtBranch, setPrevProjectWtBranch] = useState<string | null>(
    projectWorktreeBranch,
  );
  if (projectWorktreeBranch !== prevProjectWtBranch) {
    setPrevProjectWtBranch(projectWorktreeBranch);
    if (projectWorktreeBranch) setUserSelectedWorktree(null);
  }
  const { data: taskGroups } = trpc.taskGroup.list.useQuery(
    { projectId: project?.id ?? 0 },
    { enabled: !!project },
  );

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
    }
    if (project?.projectDir) repoSet.add(project.projectDir);
    return [...repoSet];
  }, [workspace, taskGroups, project]);

  const selectedRepo = userSelectedRepo ?? (allRepos.length > 0 ? allRepos[0] : null);

  // When a project-level worktree is active, derive selectedWorktree from the
  // per-repo map (overrides the user's local WorktreeSelector choice).
  const selectedWorktree: WorktreeSelection = useMemo(() => {
    if (projectWorktreeBranch && selectedRepo) {
      const worktreePath = projectRepoMap.get(selectedRepo);
      if (worktreePath) return { worktreePath };
      return null;
    }
    return userSelectedWorktree;
  }, [projectWorktreeBranch, projectRepoMap, selectedRepo, userSelectedWorktree]);

  const handleRepoChange = (repo: string) => {
    setUserSelectedRepo(repo);
    setSelectedFile(null);
    setSelectedCommit(null);
    setUserSelectedWorktree(null);
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
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'latest' },
  );

  // Commit history data
  const { data: logData, isLoading: isLogLoading } = trpc.diff.getLog.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'history' },
  );

  // Commit diff data (for file list)
  const {
    data: commitDiffData,
    isLoading: isCommitDiffLoading,
    error: commitDiffError,
    refetch: refetchCommitDiff,
  } = trpc.diff.getCommitDiff.useQuery(
    {
      repoDir: selectedRepo!,
      commitHash: selectedCommit!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && !!selectedCommit && diffViewMode === 'history' },
  );

  // Branch diff data (for file list)
  const {
    data: branchDiffData,
    isLoading: isBranchLoading,
    error: branchError,
  } = trpc.diff.getBranchDiff.useQuery(
    {
      repoDir: selectedRepo!,
      base: baseBranch,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
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
  const {
    diffComments,
    commentsForFile,
    addLineComment,
    replyToThread,
    resolve,
    remove,
    removeComment,
    refetch: refetchComments,
  } = useDiffComments(selectedRepo);

  // Invalidate comment threads when the server signals a PR change so that
  // GitHub review comments imported by the poller appear without a page reload.
  useOnServerEvent('PR_CHANGE', (payload) => {
    if (payload.workspaceId !== workspace?.id) return;
    void refetchComments();
  });

  // Correlated agent session for the PR branch (used by GitHub comment triage)
  const { data: prList } = trpc.pr.list.useQuery(
    { workspaceId: workspace?.id ?? 0 },
    {
      enabled:
        !!workspace &&
        !!projectWorktreeBranch &&
        diffComments.some((c) => c.source === 'github' && !c.resolved),
    },
  );

  const correlatedSessionId = useMemo(() => {
    if (!projectWorktreeBranch || !selectedRepo || !prList) return null;
    const pr = prList.prs.find(
      (p) => p.headBranch === projectWorktreeBranch && p.repo === selectedRepo,
    );
    return pr?.sessionId ?? null;
  }, [prList, projectWorktreeBranch, selectedRepo]);

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

  const kind = selectedFile ? fileKind(selectedFile) : null;
  const isImage = kind === 'image';
  const isBinary = kind === 'binary';
  const isTextLike = kind === 'text' || kind === 'markdown';

  // File content: original (renamed files read their previous path)
  const { data: originalData, error: originalError } = trpc.file.read.useQuery(
    {
      repoDir: selectedRepo!,
      filePath: selectedFileData?.oldPath ?? selectedFile!,
      ref: originalRef,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && isTextLike && !!originalRef, retry: false },
  );

  // File content: modified
  const { data: modifiedData, error: modifiedError } = trpc.file.read.useQuery(
    {
      repoDir: selectedRepo!,
      filePath: selectedFile!,
      ref: modifiedRef,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && isTextLike, retry: false },
  );

  // Image bytes: original/modified sides (skipped for added/deleted respectively)
  const { data: originalImageData, isLoading: originalImageLoading, error: originalImageError } =
    trpc.file.readImage.useQuery(
      {
        repoDir: selectedRepo!,
        filePath: selectedFileData?.oldPath ?? selectedFile!,
        ref: originalRef,
        worktreePath: selectedWorktree?.worktreePath,
        coderWorkspace: selectedWorktree?.coderWorkspace,
      },
      {
        enabled:
          !!selectedRepo &&
          !!selectedFile &&
          isImage &&
          !!originalRef &&
          !!selectedFileData &&
          selectedFileData.status !== 'added',
        retry: false,
      },
    );

  const { data: modifiedImageData, isLoading: modifiedImageLoading, error: modifiedImageError } =
    trpc.file.readImage.useQuery(
      {
        repoDir: selectedRepo!,
        filePath: selectedFile!,
        ref: modifiedRef,
        worktreePath: selectedWorktree?.worktreePath,
        coderWorkspace: selectedWorktree?.coderWorkspace,
      },
      {
        enabled:
          !!selectedRepo &&
          !!selectedFile &&
          isImage &&
          !!selectedFileData &&
          selectedFileData.status !== 'deleted',
        retry: false,
      },
    );

  const fileReadError = resolveFileReadError(
    selectedFileData?.status,
    originalError?.message ?? null,
    modifiedError?.message ?? null,
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
    selectedWorktree?.worktreePath,
    selectedWorktree?.coderWorkspace,
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

  const selectedFileName = selectedFile ? (selectedFile.split('/').pop() ?? selectedFile) : '';

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Top bar: view mode tabs + repo selector + review actions */}
      <div className="flex items-center justify-between gap-2 overflow-x-auto border-b border-border [scrollbar-width:thin]">
        <div className="flex shrink-0 items-center">
          <ViewModeTabs value={diffViewMode} onChange={handleDiffViewModeChange} />
          <RepoSelector
            repos={allRepos}
            selectedRepo={selectedRepo ?? ''}
            onSelectRepo={handleRepoChange}
          />
          {selectedRepo && !projectWorktreeBranch && (
            <WorktreeSelector
              workspaceSlug={workspaceSlug}
              repoDir={selectedRepo}
              value={userSelectedWorktree}
              onChange={handleUserWorktreeChange}
            />
          )}
          {projectWorktreeBranch && (
            <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <RiGitBranchLine className="size-3" />
              <span>on</span>
              <span className="font-mono text-foreground">{projectWorktreeBranch}</span>
            </div>
          )}
        </div>
        <div className="shrink-0 px-3">
          <ReviewActions repoDir={selectedRepo} diffComments={currentFileComments} />
        </div>
      </div>

      {/* GitHub comment triage bar — scoped to files in the current diff view,
          consistent with ReviewActions. Comments on files outside the active diff
          set (e.g. PR files not in the working tree) are not shown here. */}
      {selectedRepo && (
        <GithubCommentTriage
          repoDir={selectedRepo}
          diffComments={currentFileComments}
          sessionId={correlatedSessionId}
          onResolve={resolve}
        />
      )}

      {/* Branch diff: base branch input */}
      {diffViewMode === 'branch' && (
        <div className="flex items-center gap-2 overflow-x-auto border-b border-border px-3 py-1.5">
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
            <div className="flex h-full min-h-0 flex-col">
              <div className="min-h-0 flex-1 overflow-auto">
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
              {selectedCommit && (
                <div className="flex-1 min-h-0 border-t border-border overflow-auto">
                  {commitDiffError ? (
                    <div className="space-y-2 px-3 py-2">
                      <p className="text-xs text-destructive">
                        Failed to load commit changes: {commitDiffError.message}
                      </p>
                      <button
                        type="button"
                        onClick={() => refetchCommitDiff()}
                        className="border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                      >
                        Retry
                      </button>
                    </div>
                  ) : (
                    <FileListPanel
                      files={files}
                      selectedFile={selectedFile}
                      onSelectFile={setSelectedFile}
                      onRefresh={() => refetchCommitDiff()}
                      isLoading={isCommitDiffLoading}
                      commentCounts={fileCommentCounts}
                    />
                  )}
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
                  onEditorModeChange={isTextLike ? setEditorMode : undefined}
                  diffViewMode={diffViewMode}
                  saveStatus={isTextLike ? saveStatus : undefined}
                  hideViewModeToggle={isMobile || !isTextLike}
                />
              )}
              <div className="flex-1 min-h-0">
                {isImage ? (
                  <ImageDiffView
                    status={selectedFileData?.status ?? 'modified'}
                    fileName={selectedFileName}
                    original={{
                      isLoading: originalImageLoading,
                      error: originalImageError,
                      dataUri: originalImageData?.dataUri,
                    }}
                    modified={{
                      isLoading: modifiedImageLoading,
                      error: modifiedImageError,
                      dataUri: modifiedImageData?.dataUri,
                    }}
                  />
                ) : isBinary ? (
                  <NonTextFileView
                    kind="binary"
                    fileName={selectedFileName}
                  />
                ) : editorMode === 'edit' && diffViewMode === 'latest' ? (
                  <DynamicMonacoCodeEditor
                    content={modifiedContent}
                    filePath={selectedFile}
                    repoRoot={selectedWorktree?.worktreePath ?? selectedRepo ?? ''}
                    modelNamespace="diff"
                    onChange={save}
                  />
                ) : (
                  <DiffViewerPanel
                    originalContent={originalContent}
                    modifiedContent={modifiedContent}
                    viewMode={isMobile ? 'unified' : viewMode}
                    filePath={selectedFile}
                    loadError={fileReadError}
                    onChange={diffViewMode === 'latest' ? save : undefined}
                    fileComments={fileComments}
                    onAddComment={handleAddComment}
                    onReply={replyToThread}
                    onResolve={resolve}
                    onDelete={remove}
                    onDeleteComment={removeComment}
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
