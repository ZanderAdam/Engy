'use client';

import { useCallback, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
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
import { decodeSelection, encodeSelection, findSelectedFile, rowId } from './diff-selection';
import { refsFor } from './diff-refs';
import { patchSpecFor, patchContentId } from './diff-patch-spec';
import { DiffStack } from './diff-stack';
import type { DiffSectionContext } from './diff-file-section';
import { resolveReviewMode, type ReviewMode } from './review-mode';
import { useFilePatch } from './use-file-patch';
import { refreshDiff } from './diff-refresh';
import { useViewedFiles } from './use-viewed-files';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import { RiGitBranchLine, RiDownloadLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOnServerEvent } from '@/contexts/events-context';
import { EditorTabsBar } from '@/components/editor/editor-tabs';
import { useEditorTabs } from '@/components/editor/use-editor-tabs';
import type { BranchDiffTarget } from '@engy/common';
import type { ChangedFile, ViewMode, DiffViewMode } from './types';

// `worktree` keeps uncommitted work visible; `head` reproduces the pull request.
const BRANCH_TARGETS: Array<{ value: BranchDiffTarget; label: string; hint: string }> = [
  {
    value: 'worktree',
    label: 'Working tree',
    hint: 'Fork point vs. your working tree — includes uncommitted edits and untracked files',
  },
  {
    value: 'head',
    label: 'PR',
    hint: 'Fork point vs. your last commit — exactly what the GitHub pull request shows',
  },
];

const SIDEBAR_CONFIG = {
  defaultWidth: 280,
  minWidth: 180,
  maxWidth: 900,
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

  // Open-file tabs: multiple diffs can be open at once, mirroring the Code screen.
  // Every view-mode / repo / commit switch resets the set (the remembered paths
  // belong to a specific changed-files list), so open tabs are always drawn from
  // the current `files`.
  const tabs = useEditorTabs();
  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  const [diffViewMode, setDiffViewMode] = useState<DiffViewMode>('latest');
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  // null = follow the repo's detected default branch; a string is an explicit override.
  const [userBaseBranch, setUserBaseBranch] = useState<string | null>(null);
  const [branchTarget, setBranchTarget] = useState<BranchDiffTarget>('worktree');
  const [userSelectedRepo, setUserSelectedRepo] = useState<string | null>(null);
  // null follows the file count; a choice overrides it until the view changes.
  const [userReviewMode, setUserReviewMode] = useState<ReviewMode | null>(null);
  // What the stack reports as it scrolls, so the file list can follow along
  // without that feedback re-triggering a scroll.
  const [visibleRowId, setVisibleRowId] = useState<string | null>(null);
  const [userSelectedWorktree, setUserSelectedWorktree] = useState<WorktreeSelection>(null);

  // Only pending work has an index to be on one side of; a commit or a branch
  // range lists each path once.
  const sided = diffViewMode === 'latest';
  const { path: selectedFile, side: selectedSide } = decodeSelection(tabs.active, sided);

  const handleUserWorktreeChange = (worktree: WorktreeSelection) => {
    setUserSelectedWorktree(worktree);
    tabs.reset();
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
    tabs.reset();
    setSelectedCommit(null);
    setUserSelectedWorktree(null);
    setUserBaseBranch(null);
    fetchBase.reset();
  };

  const handleDiffViewModeChange = (mode: DiffViewMode) => {
    setDiffViewMode(mode);
    setUserReviewMode(null);
    tabs.reset();
    setSelectedCommit(null);
  };

  // Latest changes data. Uncommitted work changes under the reviewer while they
  // read it, so this list opts out of the app-wide staleness window and reloads
  // whenever attention comes back to the browser — every content read downstream
  // is keyed on identities it reports.
  const { data: statusData, isLoading: isStatusLoading } = trpc.diff.getStatus.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    {
      enabled: !!selectedRepo && diffViewMode === 'latest',
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
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
  } = trpc.diff.getCommitDiff.useQuery(
    {
      repoDir: selectedRepo!,
      commitHash: selectedCommit!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && !!selectedCommit && diffViewMode === 'history' },
  );

  // Default base branch, detected per repo by the daemon (origin/HEAD, then
  // well-known names). The text input overrides it.
  const {
    data: defaultBaseData,
    isLoading: isDefaultBaseLoading,
    error: defaultBaseError,
  } = trpc.diff.getDefaultBase.useQuery(
    {
      repoDir: selectedRepo!,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'branch', retry: false },
  );

  const baseBranch = userBaseBranch ?? defaultBaseData?.base ?? '';

  // Engy never fetches on its own, so a stale remote-tracking ref would silently
  // move the fork point away from what the pull request compares against.
  const utils = trpc.useUtils();
  const fetchBase = trpc.diff.fetchBase.useMutation({
    onSuccess: () => {
      void utils.diff.getBranchDiff.invalidate();
      void utils.diff.getDefaultBase.invalidate();
    },
  });

  const handleRefresh = useCallback(() => refreshDiff(utils), [utils]);

  // Branch diff data (for file list)
  const {
    data: branchDiffData,
    isLoading: isBranchLoading,
    error: branchError,
  } = trpc.diff.getBranchDiff.useQuery(
    {
      repoDir: selectedRepo!,
      base: baseBranch,
      compareTo: branchTarget,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    },
    { enabled: !!selectedRepo && diffViewMode === 'branch' && baseBranch.length > 0, retry: false },
  );

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
    () => findSelectedFile(files, selectedFile, selectedSide),
    [files, selectedFile, selectedSide],
  );

  // Which two snapshots the panes show. Branch mode reads content at the merge
  // base the file list was computed from, so the viewer and the list agree on
  // "before" even after the base branch has moved on, and it names the commit
  // HEAD resolved to rather than `HEAD` itself, which would go on meaning
  // something different after the next commit.
  const { originalRef, modifiedRef, originalId, modifiedId } = useMemo(
    () =>
      refsFor({
        diffViewMode,
        file: selectedFileData,
        side: selectedSide,
        head: statusData?.head,
        selectedCommit,
        branchTarget,
        branchDiff: branchDiffData,
      }),
    [
      diffViewMode,
      selectedFileData,
      selectedSide,
      statusData,
      selectedCommit,
      branchTarget,
      branchDiffData,
    ],
  );

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

  // Stable across renders: the diff editor subscribes to this, and a fresh
  // closure each render would tear the subscription down mid-interaction.
  const handleAddComment = useCallback(
    (lineNumber: number, side: 'modified' | 'original', text: string, codeLine: string) => {
      if (selectedFile) addLineComment(selectedFile, lineNumber, codeLine, text, side);
    },
    [selectedFile, addLineComment],
  );

  // The stack names the file, since one handler serves every section.
  const handleAddCommentTo = useCallback(
    (
      filePath: string,
      lineNumber: number,
      side: 'modified' | 'original',
      text: string,
      codeLine: string,
    ) => addLineComment(filePath, lineNumber, codeLine, text, side),
    [addLineComment],
  );

  // Review progress is scoped to workspace, project, checkout and what is being
  // diffed, so switching any of them doesn't inherit another review's ticked
  // files. The branch scope keys off the base branch name rather than the merge
  // base, which would change as soon as the base advances.
  const viewedBase = useMemo(() => {
    if (diffViewMode === 'branch') return baseBranch;
    if (diffViewMode === 'history') return selectedCommit;
    return 'latest';
  }, [diffViewMode, baseBranch, selectedCommit]);

  // Content identity per row, so a tick expires once that row's diff changes.
  // A staged row is identified by the index rather than the working tree:
  // re-staging is exactly the case where the reviewed content moved on while
  // the file on disk did not.
  const contentIds = useMemo(() => {
    const ids = new Map<string, string | undefined>();
    for (const file of files) ids.set(rowId(file), file.staged ? file.indexId : file.contentId);
    return ids;
  }, [files]);

  const { viewedPaths, toggleViewed, setViewed } = useViewedFiles(
    {
      workspaceSlug,
      projectSlug,
      dir: selectedWorktree?.worktreePath ?? selectedRepo,
      base: viewedBase,
    },
    contentIds,
  );

  const kind = selectedFile ? fileKind(selectedFile) : null;
  const isImage = kind === 'image';
  const isBinary = kind === 'binary';
  const isTextLike = kind === 'text' || kind === 'markdown';

  // Image bytes: original/modified sides (skipped for added/deleted respectively)
  const {
    data: originalImageData,
    isLoading: originalImageLoading,
    error: originalImageError,
  } = trpc.file.readImage.useQuery(
    {
      repoDir: selectedRepo!,
      filePath: selectedFileData?.oldPath ?? selectedFile!,
      ref: originalRef,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
      contentId: originalId,
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

  const {
    data: modifiedImageData,
    isLoading: modifiedImageLoading,
    error: modifiedImageError,
  } = trpc.file.readImage.useQuery(
    {
      repoDir: selectedRepo!,
      filePath: selectedFile!,
      ref: modifiedRef,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
      contentId: modifiedId,
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

  const patchSpec = useMemo(
    () =>
      patchSpecFor({
        diffViewMode,
        selectedSide,
        head: statusData?.head,
        selectedCommit,
        branchTarget,
        branchDiff: branchDiffData,
      }),
    [diffViewMode, selectedSide, statusData, selectedCommit, branchTarget, branchDiffData],
  );

  const {
    patch,
    oldSource,
    truncated: patchTruncated,
    isLoading: isPatchLoading,
    error: patchError,
  } = useFilePatch({
    repoDir: selectedRepo,
    filePath: selectedFile,
    oldPath: selectedFileData?.oldPath,
    spec: patchSpec,
    contentId: patchSpec ? patchContentId(patchSpec, selectedFileData) : undefined,
    originalRef,
    originalId,
    worktreePath: selectedWorktree?.worktreePath,
    coderWorkspace: selectedWorktree?.coderWorkspace,
    enabled: isTextLike,
  });

  const isFileListLoading =
    (diffViewMode === 'latest' && isStatusLoading) ||
    (diffViewMode === 'history' && isLogLoading) ||
    // Detecting the default base blocks the branch diff, so count it as loading
    // rather than letting the panel claim there are no changes.
    (diffViewMode === 'branch' && (isBranchLoading || isDefaultBaseLoading));

  // Filter comments to current diff files + build per-file unresolved counts
  const { currentFileComments, fileCommentCounts } = useMemo(() => {
    if (!selectedRepo)
      return { currentFileComments: [], fileCommentCounts: new Map<string, number>() };
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

  const reviewMode = resolveReviewMode(userReviewMode, files.length);

  // One value every section derives its own refs from, so no per-file wiring
  // has to be threaded through the stack.
  const sectionContext: DiffSectionContext = useMemo(
    () => ({
      diffViewMode,
      head: statusData?.head,
      selectedCommit,
      branchTarget,
      branchDiff: branchDiffData,
      repoDir: selectedRepo,
      worktreePath: selectedWorktree?.worktreePath,
      coderWorkspace: selectedWorktree?.coderWorkspace,
    }),
    [
      diffViewMode,
      statusData,
      selectedCommit,
      branchTarget,
      branchDiffData,
      selectedRepo,
      selectedWorktree,
    ],
  );

  // The stack scrolls to whatever the list last selected; the list highlights
  // whatever the stack last scrolled past. Keeping the two in separate state is
  // what stops them driving each other in a loop.
  const scrollToRowId = selectedFileData ? rowId(selectedFileData) : null;
  const listSelection = reviewMode === 'stack' ? (visibleRowId ?? tabs.active) : tabs.active;

  // The page mounts outside the project layout's tooltip provider, so it brings
  // its own; nesting providers is safe.
  return (
    <TooltipProvider>
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
          <div className="flex shrink-0 items-center gap-2 px-3">
            {files.length > 0 && !isMobile && (
              <div className="flex shrink-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setUserReviewMode('stack')}
                      className={cn(reviewMode === 'stack' && 'bg-muted text-foreground')}
                    >
                      All files
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    Every file in one scrolling review
                  </TooltipContent>
                </Tooltip>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setUserReviewMode('single')}
                  className={cn(reviewMode === 'single' && 'bg-muted text-foreground')}
                >
                  One file
                </Button>
              </div>
            )}
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
              onChange={(e) => {
                setUserBaseBranch(e.target.value);
                // Feedback belongs to the ref that was fetched, not the new one.
                fetchBase.reset();
              }}
              className="h-6 border border-border bg-transparent px-2 text-xs text-foreground focus:outline-none focus:border-ring"
              placeholder={defaultBaseData?.base ?? 'origin/main'}
            />
            {userBaseBranch !== null &&
              defaultBaseData &&
              userBaseBranch !== defaultBaseData.base && (
                <button
                  type="button"
                  onClick={() => setUserBaseBranch(null)}
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  reset to {defaultBaseData.base}
                </button>
              )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => fetchBase.mutate({ repoDir: selectedRepo!, base: baseBranch })}
                  disabled={!selectedRepo || !baseBranch || fetchBase.isPending}
                  className="h-6 w-6 shrink-0 p-0"
                >
                  <RiDownloadLine
                    className={cn('size-3.5', fetchBase.isPending && 'animate-pulse')}
                  />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Fetch the base branch, so the fork point matches the remote
              </TooltipContent>
            </Tooltip>

            {/* Which side the fork point is compared against. */}
            <div className="flex shrink-0">
              {BRANCH_TARGETS.map(({ value, label, hint }) => (
                <Tooltip key={value}>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setBranchTarget(value)}
                      className={cn(branchTarget === value && 'bg-muted text-foreground')}
                    >
                      {label}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">{hint}</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {branchDiffData?.mergeBase && (
              <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                forked at{' '}
                <span className="font-mono text-foreground">
                  {branchDiffData.mergeBase.slice(0, 7)}
                </span>
              </span>
            )}

            {branchError && (
              <span className="text-xs text-destructive">
                {branchError.message.replace(/^.*Invalid base ref/, 'Invalid ref')}
              </span>
            )}
            {defaultBaseError && !userBaseBranch && (
              <span className="text-xs text-destructive">
                Could not detect the default branch — enter a base ref above.
              </span>
            )}
            {fetchBase.isSuccess && !fetchBase.data?.remote && (
              <span className="text-xs text-muted-foreground">
                No remote to fetch for this base.
              </span>
            )}
            {fetchBase.error && (
              <span className="text-xs text-destructive">
                Fetch failed: {fetchBase.error.message}
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
                      tabs.reset();
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
                          onClick={handleRefresh}
                          className="border border-border px-2 py-1 text-xs text-foreground hover:bg-muted"
                        >
                          Retry
                        </button>
                      </div>
                    ) : (
                      <FileListPanel
                        files={files}
                        selectedFile={listSelection}
                        onSelectFile={tabs.open}
                        onRefresh={handleRefresh}
                        isLoading={isCommitDiffLoading}
                        commentCounts={fileCommentCounts}
                        viewedPaths={viewedPaths}
                        onToggleViewed={toggleViewed}
                        onSetViewed={setViewed}
                      />
                    )}
                  </div>
                )}
              </div>
            ) : (
              <FileListPanel
                files={files}
                selectedFile={listSelection}
                onSelectFile={tabs.open}
                onRefresh={handleRefresh}
                sided={sided}
                isLoading={isFileListLoading}
                commentCounts={fileCommentCounts}
                viewedPaths={viewedPaths}
                onToggleViewed={toggleViewed}
                onSetViewed={setViewed}
              />
            )
          }
          centerContent={
            <div className="flex flex-1 min-h-0 flex-col">
              {reviewMode === 'single' && <EditorTabsBar tabs={tabs} />}
              {allRepos.length === 0 ? (
                <div className="flex flex-1 items-center justify-center">
                  <p className="text-sm text-muted-foreground">
                    No repositories configured for this workspace
                  </p>
                </div>
              ) : reviewMode === 'stack' ? (
                <div className="flex flex-1 min-h-0 flex-col">
                  <DiffStack
                    files={files}
                    context={sectionContext}
                    viewMode={isMobile ? 'unified' : viewMode}
                    scrollToRowId={scrollToRowId}
                    onVisibleRowChange={setVisibleRowId}
                    commentsForFile={commentsForFile}
                    viewedPaths={viewedPaths}
                    onToggleViewed={toggleViewed}
                    onOpenSingle={(file) => {
                      setUserReviewMode('single');
                      tabs.open(
                        encodeSelection(
                          file.path,
                          sided ? (file.staged ? 'staged' : 'unstaged') : null,
                        ),
                      );
                    }}
                    onAddComment={handleAddCommentTo}
                    onReply={replyToThread}
                    onResolve={resolve}
                    onDelete={remove}
                    onDeleteComment={removeComment}
                  />
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
                      hideViewModeToggle={isMobile || !isTextLike}
                      isViewed={viewedPaths.has(selectedFile)}
                      onToggleViewed={() => toggleViewed(selectedFile)}
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
                      <NonTextFileView kind="binary" fileName={selectedFileName} />
                    ) : (
                      <DiffViewerPanel
                        patch={patch}
                        oldSource={oldSource}
                        viewMode={isMobile ? 'unified' : viewMode}
                        filePath={selectedFile}
                        scrollKey={tabs.active ?? undefined}
                        isLoading={isPatchLoading}
                        truncated={patchTruncated}
                        loadError={patchError}
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
              )}
            </div>
          }
        />
      </div>
    </TooltipProvider>
  );
}
