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

  const { originalRef, modifiedRef, originalId, modifiedId } = useMemo(
    () =>
      selectedFileData && selectedSide
        ? latestRefs(selectedFileData, selectedSide, statusData?.head)
        : {},
    [selectedFileData, selectedSide, statusData],
  );

  // File content: original
  const { data: originalData } = trpc.file.read.useQuery(
    {
      repoDir: dirPath,
      filePath: selectedFileData?.oldPath ?? selectedFile!,
      ref: originalRef,
      contentId: originalId,
    },
    { enabled: !!selectedFile && !!originalRef, retry: false },
  );

  // File content: modified
  const { data: modifiedData } = trpc.file.read.useQuery(
    { repoDir: dirPath, filePath: selectedFile!, ref: modifiedRef, contentId: modifiedId },
    { enabled: !!selectedFile && selectedFileData?.status !== 'deleted', retry: false },
  );

  const originalContent = useMemo(() => {
    if (selectedFileData?.status === 'added') return '';
    return originalData?.content ?? '';
  }, [originalData, selectedFileData]);

  const modifiedContent = useMemo(() => {
    if (selectedFileData?.status === 'deleted') return '';
    return modifiedData?.content ?? '';
  }, [modifiedData, selectedFileData]);

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
                originalContent={originalContent}
                modifiedContent={modifiedContent}
                viewMode={viewMode}
                filePath={selectedFile}
                repoRoot={dirPath}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
