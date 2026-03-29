'use client';

import { useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { FileListPanel } from './file-list-panel';
import { DiffViewerPanel } from './diff-viewer-panel';
import { DiffHeader } from './diff-header';
import { ReviewActions } from './review-actions';
import { useDiffComments } from './use-diff-comments';
import type { ChangedFile, ViewMode } from './types';

interface DirDiffPanelProps {
  dirPath: string;
}

export function DirDiffPanel({ dirPath }: DirDiffPanelProps) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('unified');

  const {
    data: statusData,
    isLoading: isStatusLoading,
    refetch: refetchStatus,
  } = trpc.diff.getStatus.useQuery({ repoDir: dirPath });

  const { diffComments } = useDiffComments(dirPath);

  const files: ChangedFile[] = useMemo(() => statusData?.files ?? [], [statusData]);

  const selectedFileData = useMemo(
    () => files.find((f) => f.path === selectedFile),
    [files, selectedFile],
  );

  // File content: original (HEAD)
  const { data: originalData } = trpc.file.read.useQuery(
    { repoDir: dirPath, filePath: selectedFile!, ref: 'HEAD' },
    { enabled: !!selectedFile && selectedFileData?.status !== 'added', retry: false },
  );

  // File content: modified (working tree)
  const { data: modifiedData } = trpc.file.read.useQuery(
    { repoDir: dirPath, filePath: selectedFile! },
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
          selectedFile={selectedFile}
          onSelectFile={setSelectedFile}
          onRefresh={() => refetchStatus()}
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
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
