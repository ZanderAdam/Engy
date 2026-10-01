'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { trpc } from '@/lib/trpc';
import { ThreePanelLayout } from '@/components/layout/three-panel-layout';
import { useIsMobile } from '@/hooks/use-mobile';
import { FileListPanel } from './file-list-panel';
import { DiffViewerPanel } from './diff-viewer-panel';
import { ImageDiffView } from './image-diff-view';
import { DiffHeader } from './diff-header';
import { NonTextFileView } from '@/components/editor/non-text-file-view';
import { fileKind } from '@/lib/file-types';
import { ReviewActions } from './review-actions';
import { ReviewSummaryPanel } from './review-summary-panel';
import { GithubCommentTriage } from './github-comment-triage';
import { useDiffComments } from './use-diff-comments';
import { scopeCommentsToFiles } from './comment-scope';
import { decodeSelection, encodeSelection, findSelectedFile, rowId } from './diff-selection';
import { refsFor } from './diff-refs';
import {
  patchSpecFor,
  patchContentId,
  reviewSpecFor,
  type PatchSpecInputs,
} from './diff-patch-spec';
import { DiffStack } from './diff-stack';
import type { DiffSectionContext } from './diff-file-section';
import { resolveReviewMode, type ReviewMode } from './review-mode';
import { useFilePatch } from './use-file-patch';
import { refreshDiff } from './diff-refresh';
import { useViewedFiles } from './use-viewed-files';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useOnServerEvent } from '@/contexts/events-context';
import { EditorTabsBar } from '@/components/editor/editor-tabs';
import type { EditorTabsController } from '@/components/editor/use-editor-tabs';
import type { ChangedFile, ViewMode } from './types';

const SIDEBAR_CONFIG = {
  defaultWidth: 280,
  minWidth: 180,
  maxWidth: 900,
  storageKey: 'engy-diffs-sidebar-width',
} as const;

export type DiffSource = Omit<PatchSpecInputs, 'selectedSide'>;

interface DiffReviewSurfaceProps {
  workspaceSlug: string;
  projectSlug: string | null;
  workspaceId?: number;
  repoDir: string | null;
  worktreePath?: string;
  coderWorkspace?: string;
  source: DiffSource;
  files: ChangedFile[];
  isFilesLoading: boolean;
  commentBranchKey: string | null;
  correlatedBranch: string | null;
  viewedBase: string | null;
  tabs: EditorTabsController;
  toolbarLeading?: ReactNode;
  subToolbar?: ReactNode;
  wrapFileList?: (fileList: ReactNode) => ReactNode;
}

export function DiffReviewSurface({
  workspaceSlug,
  projectSlug,
  workspaceId,
  repoDir,
  worktreePath,
  coderWorkspace,
  source,
  files,
  isFilesLoading,
  commentBranchKey,
  correlatedBranch,
  viewedBase,
  tabs,
  toolbarLeading,
  subToolbar,
  wrapFileList,
}: DiffReviewSurfaceProps) {
  const isMobile = useIsMobile();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [prevIsMobile, setPrevIsMobile] = useState(false);
  if (isMobile !== prevIsMobile) {
    setPrevIsMobile(isMobile);
    setSidebarCollapsed(isMobile);
  }

  const { diffViewMode, selectedCommit } = source;

  const [viewMode, setViewMode] = useState<ViewMode>('unified');
  // null follows the file count; a choice overrides it until the view changes.
  const [userReviewMode, setUserReviewMode] = useState<ReviewMode | null>(null);
  const [prevDiffViewMode, setPrevDiffViewMode] = useState(diffViewMode);
  if (diffViewMode !== prevDiffViewMode) {
    setPrevDiffViewMode(diffViewMode);
    setUserReviewMode(null);
  }
  // What the stack reports as it scrolls, so the file list can follow along
  // without that feedback re-triggering a scroll.
  const [visibleRowId, setVisibleRowId] = useState<string | null>(null);

  // Only pending work has an index to be on one side of; a commit or a branch
  // range lists each path once.
  const sided = diffViewMode === 'latest';
  const { path: selectedFile, side: selectedSide } = decodeSelection(tabs.active, sided);

  const utils = trpc.useUtils();
  const handleRefresh = useCallback(() => refreshDiff(utils), [utils]);

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
    () => refsFor({ ...source, file: selectedFileData, side: selectedSide }),
    [source, selectedFileData, selectedSide],
  );

  const {
    diffComments,
    reviewSummary,
    commentsForFile,
    addLineComment,
    replyToThread,
    resolve,
    remove,
    removeComment,
    refetch: refetchComments,
  } = useDiffComments(repoDir, commentBranchKey);

  const { data: project } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspaceId ?? 0, slug: projectSlug ?? '' },
    { enabled: !!workspaceId && !!projectSlug },
  );
  const guideProject =
    project && projectSlug ? { id: project.id, workspaceSlug, slug: projectSlug } : undefined;

  // Invalidate comment threads when the server signals a PR change so that
  // GitHub review comments imported by the poller appear without a page reload.
  useOnServerEvent('PR_CHANGE', (payload) => {
    if (payload.workspaceId !== workspaceId) return;
    void refetchComments();
  });

  // Correlated agent session for the PR branch (used by GitHub comment triage)
  const { data: prList } = trpc.pr.list.useQuery(
    { workspaceId: workspaceId ?? 0 },
    {
      enabled:
        !!workspaceId &&
        !!correlatedBranch &&
        diffComments.some((c) => c.source === 'github' && !c.resolved),
    },
  );

  const correlatedSessionId = useMemo(() => {
    if (!correlatedBranch || !repoDir || !prList) return null;
    const pr = prList.prs.find((p) => p.headBranch === correlatedBranch && p.repo === repoDir);
    return pr?.sessionId ?? null;
  }, [prList, correlatedBranch, repoDir]);

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
      dir: worktreePath ?? repoDir,
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
      repoDir: repoDir!,
      filePath: selectedFileData?.oldPath ?? selectedFile!,
      ref: originalRef,
      worktreePath,
      coderWorkspace,
      contentId: originalId,
    },
    {
      enabled:
        !!repoDir &&
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
      repoDir: repoDir!,
      filePath: selectedFile!,
      ref: modifiedRef,
      worktreePath,
      coderWorkspace,
      contentId: modifiedId,
    },
    {
      enabled:
        !!repoDir &&
        !!selectedFile &&
        isImage &&
        !!selectedFileData &&
        selectedFileData.status !== 'deleted',
      retry: false,
    },
  );

  const patchSpec = useMemo(
    () => patchSpecFor({ ...source, selectedSide }),
    [source, selectedSide],
  );

  const reviewSpec = useMemo(() => reviewSpecFor(source), [source]);

  const {
    patch,
    oldSource,
    truncated: patchTruncated,
    isLoading: isPatchLoading,
    error: patchError,
  } = useFilePatch({
    repoDir,
    filePath: selectedFile,
    oldPath: selectedFileData?.oldPath,
    spec: patchSpec,
    contentId: patchSpec ? patchContentId(patchSpec, selectedFileData) : undefined,
    originalRef,
    originalId,
    worktreePath,
    coderWorkspace,
    enabled: isTextLike,
  });

  const { inScope: currentFileComments, unresolvedByFile: fileCommentCounts } = useMemo(
    () => scopeCommentsToFiles(diffComments, files),
    [diffComments, files],
  );

  const selectedFileName = selectedFile ? (selectedFile.split('/').pop() ?? selectedFile) : '';

  const reviewMode = resolveReviewMode(userReviewMode, files.length);

  // One value every section derives its own refs from, so no per-file wiring
  // has to be threaded through the stack.
  const sectionContext: DiffSectionContext = useMemo(
    () => ({ ...source, repoDir, worktreePath, coderWorkspace }),
    [source, repoDir, worktreePath, coderWorkspace],
  );

  // The stack scrolls to whatever the list last selected; the list highlights
  // whatever the stack last scrolled past. Keeping the two in separate state is
  // what stops them driving each other in a loop.
  const selectFileByPath = (path: string) => {
    const file = files.find((f) => f.path === path);
    if (!file) return;
    tabs.open(encodeSelection(path, sided ? (file.staged ? 'staged' : 'unstaged') : null));
  };

  const scrollToRowId = selectedFileData ? rowId(selectedFileData) : null;
  const listSelection = reviewMode === 'stack' ? (visibleRowId ?? tabs.active) : tabs.active;

  const fileList = (
    <FileListPanel
      files={files}
      selectedFile={listSelection}
      onSelectFile={tabs.open}
      onRefresh={handleRefresh}
      sided={sided}
      isLoading={isFilesLoading}
      commentCounts={fileCommentCounts}
      viewedPaths={viewedPaths}
      onToggleViewed={toggleViewed}
      onSetViewed={setViewed}
    />
  );

  // The surface mounts outside the project layout's tooltip provider, so it
  // brings its own; nesting providers is safe.
  return (
    <TooltipProvider>
      <div className="flex flex-1 min-h-0 flex-col">
        {/* Top bar: caller's controls + review mode + review actions */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto border-b border-border [scrollbar-width:thin]">
          <div className="flex shrink-0 items-center">{toolbarLeading}</div>
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
                  <TooltipContent side="bottom">Every file in one scrolling review</TooltipContent>
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
            <ReviewActions
              repoDir={repoDir}
              diffComments={currentFileComments}
              reviewSpec={reviewSpec}
              worktreePath={worktreePath}
              coderWorkspace={coderWorkspace}
              projectId={guideProject?.id}
            />
          </div>
        </div>

        {/* GitHub comment triage bar — scoped to files in the current diff view,
          consistent with ReviewActions. Comments on files outside the active diff
          set (e.g. PR files not in the working tree) are not shown here. */}
        {repoDir && (
          <GithubCommentTriage
            diffComments={currentFileComments}
            sessionId={correlatedSessionId}
            onResolve={resolve}
          />
        )}

        {subToolbar}

        {/* Main content: file list + diff viewer */}
        <ThreePanelLayout
          className="flex-1 min-h-0"
          left={SIDEBAR_CONFIG}
          isMobile={isMobile}
          leftCollapsed={sidebarCollapsed}
          onLeftCollapsedChange={setSidebarCollapsed}
          leftContent={wrapFileList ? wrapFileList(fileList) : fileList}
          centerContent={
            <div className="flex flex-1 min-h-0 flex-col">
              <ReviewSummaryPanel
                summary={reviewSummary}
                findingCount={
                  currentFileComments.filter((c) => c.source === 'agent' && !c.resolved).length
                }
                onDelete={remove}
                onSelectFile={selectFileByPath}
                guideProject={guideProject}
              />
              {reviewMode === 'single' && <EditorTabsBar tabs={tabs} />}
              {!repoDir ? (
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
                        repoDir={repoDir}
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
