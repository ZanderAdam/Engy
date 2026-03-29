'use client';

import { useMemo, useState } from 'react';
import { RiLoopLeftLine, RiFolderLine, RiSearchLine, RiChat3Line } from '@remixicon/react';
import type { TreeRenderItemParams } from '@/components/tree-view';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FileTree } from './file-tree';
import type { ChangedFile, GitFileStatus } from '@/components/diff/types';

interface FileListPanelProps {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  commentCounts?: Map<string, number>;
}

const STATUS_COLORS: Record<GitFileStatus, string> = {
  added: 'text-green-500',
  modified: 'text-blue-500',
  deleted: 'text-red-500',
  renamed: 'text-yellow-500',
};

const STATUS_LABELS: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

function createRenderItem(
  fileStatusMap: Map<string, GitFileStatus>,
  commentCounts?: Map<string, number>,
) {
  return function DiffRenderItem({ item, isLeaf }: TreeRenderItemParams) {
    if (!isLeaf) {
      return (
        <>
          <RiFolderLine className="h-4 w-4 shrink-0 mr-2 text-muted-foreground" />
          <span className="text-sm truncate">{item.name}</span>
        </>
      );
    }

    const status = fileStatusMap.get(item.id);
    const commentCount = commentCounts?.get(item.id);

    return (
      <>
        {status && (
          <span className={cn('shrink-0 font-mono text-[10px] mr-1.5', STATUS_COLORS[status])}>
            {STATUS_LABELS[status]}
          </span>
        )}
        <span className="flex-grow text-sm truncate">{item.name}</span>
        {commentCount != null && commentCount > 0 && (
          <RiChat3Line className="size-3 shrink-0 text-amber-500 mr-1" />
        )}
      </>
    );
  };
}

export function FileListPanel({
  files,
  selectedFile,
  onSelectFile,
  onRefresh,
  isLoading,
  commentCounts,
}: FileListPanelProps) {
  const [filter, setFilter] = useState('');

  const statusCounts = useMemo(() => {
    const counts = { added: 0, modified: 0, deleted: 0, renamed: 0 };
    for (const file of files) counts[file.status]++;
    return counts;
  }, [files]);

  const { stagedFiles, unstagedFiles, hasStagedAndUnstaged } = useMemo(() => {
    const staged = files.filter((f) => f.staged);
    const unstaged = files.filter((f) => !f.staged);
    return {
      stagedFiles: staged,
      unstagedFiles: unstaged,
      hasStagedAndUnstaged: staged.length > 0 && unstaged.length > 0,
    };
  }, [files]);

  const fileStatusMap = useMemo(() => {
    const map = new Map<string, GitFileStatus>();
    for (const f of files) map.set(f.path, f.status);
    return map;
  }, [files]);

  const renderItem = useMemo(
    () => createRenderItem(fileStatusMap, commentCounts),
    [fileStatusMap, commentCounts],
  );

  const filteredPaths = useMemo(() => {
    const q = filter.toLowerCase();
    return files
      .filter((f) => !q || f.path.toLowerCase().includes(q))
      .map((f) => f.path);
  }, [files, filter]);

  const stagedPaths = useMemo(
    () => stagedFiles.map((f) => f.path),
    [stagedFiles],
  );

  const unstagedPaths = useMemo(
    () => unstagedFiles.map((f) => f.path),
    [unstagedFiles],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">
            {files.length} file{files.length !== 1 ? 's' : ''} changed
          </span>
          {statusCounts.added > 0 && (
            <span className="text-xs text-green-500">+{statusCounts.added}</span>
          )}
          {statusCounts.modified > 0 && (
            <span className="text-xs text-blue-500">~{statusCounts.modified}</span>
          )}
          {statusCounts.deleted > 0 && (
            <span className="text-xs text-red-500">-{statusCounts.deleted}</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          disabled={isLoading}
          className="h-6 w-6 p-0"
        >
          <RiLoopLeftLine className={cn('size-3.5', isLoading && 'animate-spin')} />
        </Button>
      </div>

      {files.length > 5 && (
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
          <RiSearchLine className="size-3 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files..."
            className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>
      )}

      {files.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">No changes detected</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {hasStagedAndUnstaged ? (
            <>
              <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Staged
              </div>
              <FileTree
                filePaths={stagedPaths}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                renderItem={renderItem}
                showFilter={false}
              />
              <div className="px-2 pt-3 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                Unstaged
              </div>
              <FileTree
                filePaths={unstagedPaths}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                renderItem={renderItem}
                showFilter={false}
              />
            </>
          ) : (
            <FileTree
              filePaths={filteredPaths}
              selectedFile={selectedFile}
              onSelectFile={onSelectFile}
              renderItem={renderItem}
              showFilter={false}
            />
          )}
        </div>
      )}
    </div>
  );
}
