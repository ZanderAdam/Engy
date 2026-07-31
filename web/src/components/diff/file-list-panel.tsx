'use client';

import { useMemo, useState } from 'react';
import {
  RiLoopLeftLine,
  RiFolderLine,
  RiChat3Line,
  RiExpandUpDownLine,
  RiContractUpDownLine,
  RiCheckboxLine,
  RiCheckboxBlankLine,
  RiCheckboxMultipleLine,
  RiCheckboxMultipleFill,
} from '@remixicon/react';
import type { TreeRenderItemParams } from '@/components/tree-view';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { FileTree } from './file-tree';
import { DiffFilterBar } from './diff-filter-bar';
import { buildFileTree, collectDirIds } from './file-tree-model';
import {
  EMPTY_FILTER,
  allViewed,
  countByStatus,
  filterFiles,
  isFilterActive,
} from './file-filters';
import type { FilterState } from './file-filters';
import type { ChangedFile, GitFileStatus } from '@/components/diff/types';

interface FileListPanelProps {
  files: ChangedFile[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  commentCounts?: Map<string, number>;
  viewedPaths?: Set<string>;
  onToggleViewed?: (path: string) => void;
  onSetViewed?: (paths: string[], viewed: boolean) => void;
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

interface RenderItemContext {
  fileStatusMap: Map<string, GitFileStatus>;
  commentCounts?: Map<string, number>;
  viewedPaths?: Set<string>;
  onToggleViewed?: (path: string) => void;
}

function createRenderItem({
  fileStatusMap,
  commentCounts,
  viewedPaths,
  onToggleViewed,
}: RenderItemContext) {
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
    const isViewed = viewedPaths?.has(item.id) ?? false;

    return (
      <>
        {status && (
          <span className={cn('shrink-0 font-mono text-[10px] mr-1.5', STATUS_COLORS[status])}>
            {STATUS_LABELS[status]}
          </span>
        )}
        <span
          className={cn(
            'flex-grow text-sm truncate',
            isViewed && 'text-muted-foreground/50 line-through',
          )}
        >
          {item.name}
        </span>
        {commentCount != null && commentCount > 0 && (
          <RiChat3Line className="size-3 shrink-0 text-amber-500 mr-1" />
        )}
        {onToggleViewed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="checkbox"
                aria-checked={isViewed}
                aria-label={isViewed ? 'Mark unviewed' : 'Mark viewed'}
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleViewed(item.id);
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter' && e.key !== ' ') return;
                  e.preventDefault();
                  e.stopPropagation();
                  onToggleViewed(item.id);
                }}
                // Padded well beyond the glyph so the hit target stays comfortable
                // at this row height.
                className="-my-1 ml-1 mr-0.5 flex shrink-0 cursor-pointer items-center p-1"
              >
                {isViewed ? (
                  <RiCheckboxLine className="size-4 text-primary" />
                ) : (
                  <RiCheckboxBlankLine className="size-4 text-muted-foreground/70 hover:text-foreground" />
                )}
              </span>
            </TooltipTrigger>
            <TooltipContent side="left">
              {isViewed ? 'Mark unviewed' : 'Mark viewed'}
            </TooltipContent>
          </Tooltip>
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
  viewedPaths,
  onToggleViewed,
  onSetViewed,
}: FileListPanelProps) {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  // Directories start collapsed and open one level at a time. The set lives here
  // so expand-all can drive every tree at once and so collapse state survives
  // filtering; ids are namespaced per tree, so the staged and unstaged lists
  // still toggle independently.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const statusCounts = useMemo(() => countByStatus(files), [files]);

  const commentedCount = useMemo(
    () => files.filter((f) => (commentCounts?.get(f.path) ?? 0) > 0).length,
    [files, commentCounts],
  );

  const unviewedCount = useMemo(
    () => files.filter((f) => !viewedPaths?.has(f.path)).length,
    [files, viewedPaths],
  );

  const { files: visibleFiles, error: queryError } = useMemo(
    () => filterFiles(files, filter, { commentCounts, viewedPaths }),
    [files, filter, commentCounts, viewedPaths],
  );

  const fileStatusMap = useMemo(() => {
    const map = new Map<string, GitFileStatus>();
    for (const f of files) map.set(f.path, f.status);
    return map;
  }, [files]);

  const renderItem = useMemo(
    () => createRenderItem({ fileStatusMap, commentCounts, viewedPaths, onToggleViewed }),
    [fileStatusMap, commentCounts, viewedPaths, onToggleViewed],
  );

  const { stagedItems, unstagedItems, allItems, hasStagedAndUnstaged } = useMemo(() => {
    const staged = visibleFiles.filter((f) => f.staged).map((f) => f.path);
    const unstaged = visibleFiles.filter((f) => !f.staged).map((f) => f.path);
    return {
      stagedItems: buildFileTree(staged, 'staged:'),
      unstagedItems: buildFileTree(unstaged, 'unstaged:'),
      allItems: buildFileTree(visibleFiles.map((f) => f.path)),
      hasStagedAndUnstaged: staged.length > 0 && unstaged.length > 0,
    };
  }, [visibleFiles]);

  const allDirIds = useMemo(
    () =>
      hasStagedAndUnstaged
        ? [...collectDirIds(stagedItems), ...collectDirIds(unstagedItems)]
        : collectDirIds(allItems),
    [hasStagedAndUnstaged, stagedItems, unstagedItems, allItems],
  );

  const allExpanded = allDirIds.length > 0 && allDirIds.every((id) => expandedIds.has(id));

  const toggleExpandAll = () => setExpandedIds(allExpanded ? new Set() : new Set(allDirIds));

  const filtering = isFilterActive(filter);

  // Bulk marking acts on exactly what the filters leave on screen, so narrowing
  // to a subset and clearing it in one go is the intended workflow.
  const allVisibleViewed = allViewed(
    visibleFiles.map((f) => f.path),
    viewedPaths ?? new Set(),
  );

  const toggleViewedForVisible = () =>
    onSetViewed?.(
      visibleFiles.map((f) => f.path),
      !allVisibleViewed,
    );

  // The panel is rendered on routes without a surrounding provider (the /open
  // quick-diff view), so it supplies its own; nesting providers is safe.
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {filtering ? `${visibleFiles.length} of ${files.length}` : files.length} file
            {files.length !== 1 ? 's' : ''} changed
          </span>
          <div className="flex items-center gap-0.5">
            {onSetViewed && visibleFiles.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleViewedForVisible}
                    className="h-6 w-6 p-0"
                  >
                    {allVisibleViewed ? (
                      <RiCheckboxMultipleFill className="size-3.5 text-primary" />
                    ) : (
                      <RiCheckboxMultipleLine className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {`Mark ${visibleFiles.length} shown file${visibleFiles.length === 1 ? '' : 's'} ${
                    allVisibleViewed ? 'unviewed' : 'viewed'
                  }`}
                </TooltipContent>
              </Tooltip>
            )}
            {allDirIds.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleExpandAll}
                    className="h-6 w-6 p-0"
                  >
                    {allExpanded ? (
                      <RiContractUpDownLine className="size-3.5" />
                    ) : (
                      <RiExpandUpDownLine className="size-3.5" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {allExpanded ? 'Collapse all' : 'Expand all'}
                </TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRefresh}
                  disabled={isLoading}
                  className="h-6 w-6 p-0"
                >
                  <RiLoopLeftLine className={cn('size-3.5', isLoading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Refresh</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {files.length > 0 && (
          <DiffFilterBar
            filter={filter}
            onFilterChange={setFilter}
            statusCounts={statusCounts}
            commentedCount={commentedCount}
            unviewedCount={unviewedCount}
            viewedTrackingEnabled={!!onToggleViewed}
            queryError={queryError}
          />
        )}

        {files.length === 0 && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-xs text-muted-foreground">No changes detected</p>
          </div>
        )}

        {files.length > 0 && visibleFiles.length === 0 && (
          <div className="flex flex-1 items-center justify-center px-3 text-center">
            <p className="text-xs text-muted-foreground">No files match the current filters</p>
          </div>
        )}

        {visibleFiles.length > 0 && (
          <div className="flex-1 overflow-auto">
            {hasStagedAndUnstaged ? (
              <>
                <div className="px-2 pt-2 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Staged
                </div>
                <FileTree
                  items={stagedItems}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  renderItem={renderItem}
                  expandedIds={expandedIds}
                  onExpandedChange={setExpandedIds}
                />
                <div className="px-2 pt-3 pb-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
                  Unstaged
                </div>
                <FileTree
                  items={unstagedItems}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  renderItem={renderItem}
                  expandedIds={expandedIds}
                  onExpandedChange={setExpandedIds}
                />
              </>
            ) : (
              <FileTree
                items={allItems}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                renderItem={renderItem}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
              />
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
