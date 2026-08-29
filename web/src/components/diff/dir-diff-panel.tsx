'use client';

import { useCallback, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { FileListPanel } from './file-list-panel';
import { DiffViewerPanel } from './diff-viewer-panel';
import { DiffHeader } from './diff-header';
import { ReviewActions } from './review-actions';
import { useDiffComments } from './use-diff-comments';
import { decodeSelection, findSelectedFile } from './diff-selection';
import { latestRefs } from './diff-refs';
import { patchSpecFor, patchContentId } from './diff-patch-spec';
import { useFilePatch } from './use-file-patch';
import { refreshDiff } from './diff-refresh';
import type { ChangedFile, ViewMode } from './types';

interface DirDiffPanelProps {
  dirPath: string;
}

export function DirDiffPanel({ dirPath }: DirDiffPanelProps) {
  const [selection, setSelection] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');

  const { path: selectedFile, side: selectedSide } = decodeSelection(selection, true);

  const { data: statusData, isLoading: isStatusLoading } = trpc.diff.getStatus.useQuery(
    { repoDir: dirPath },
    { staleTime: 0, refetchOnWindowFocus: true },
  );

  const utils = trpc.useUtils();
  const handleRefresh = useCallback(() => refreshDiff(utils), [utils]);

  const { diffComments } = useDiffComments(dirPath);

  const files: ChangedFile[] = useMemo(() => statusData?.files ?? [], [statusData]);

  const selectedFileData = useMemo(
    () => findSelectedFile(files, selectedFile, selectedSide),
    [files, selectedFile, selectedSide],
  );

  const { originalRef, originalId } = useMemo(
    () =>
      selectedFileData && selectedSide
        ? latestRefs(selectedFileData, selectedSide, statusData?.head)
        : {},
    [selectedFileData, selectedSide, statusData],
  );

  const spec = useMemo(
    () =>
      patchSpecFor({
        diffViewMode: 'latest',
        selectedSide,
        head: statusData?.head,
        selectedCommit: null,
        branchTarget: 'worktree',
      }),
    [selectedSide, statusData],
  );

  const { patch, oldSource, truncated, isLoading, error } = useFilePatch({
    repoDir: dirPath,
    filePath: selectedFile,
    oldPath: selectedFileData?.oldPath,
    spec,
    contentId: spec ? patchContentId(spec, selectedFileData) : undefined,
    originalRef,
    originalId,
  });

  return (
    <div className="flex flex-1 min-h-0">
      <div className="flex w-[240px] flex-shrink-0 flex-col border-r border-border">
        <FileListPanel
          files={files}
          selectedFile={selection}
          onSelectFile={setSelection}
          onRefresh={handleRefresh}
          sided
          isLoading={isStatusLoading}
        />
      </div>

      <div className="flex flex-1 min-w-0 flex-col">
        <div className="flex items-center justify-end border-b border-border px-3 py-1">
          <ReviewActions repoDir={dirPath} diffComments={diffComments} />
        </div>

        {!selectedFile ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">Select a file to view its diff</p>
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
            <div className="flex-1 min-h-0">
              <DiffViewerPanel
                patch={patch}
                oldSource={oldSource}
                viewMode={viewMode}
                filePath={selectedFile}
                scrollKey={selection ?? undefined}
                isLoading={isLoading}
                truncated={truncated}
                loadError={error}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
