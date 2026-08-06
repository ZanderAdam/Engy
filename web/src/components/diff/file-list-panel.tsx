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
import { FileTreeSection } from './file-tree-section';
import { useSectionSplit } from './use-section-split';
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
import { decodeSelection, encodeSelection, rowId, selectionPrefix } from './diff-selection';
import type { ChangedFile, DiffSide, GitFileStatus } from '@/components/diff/types';

interface FileListPanelProps {
  files: ChangedFile[];
  /** Whatever `onSelectFile` last emitted — a side-qualified id when `sided`. */
  selectedFile: string | null;
  onSelectFile: (selection: string) => void;
  onRefresh: () => void;
  isLoading?: boolean;
  commentCounts?: Map<string, number>;
  viewedPaths?: Set<string>;
  onToggleViewed?: (path: string) => void;
  onSetViewed?: (paths: string[], viewed: boolean) => void;
  /**
   * Whether the list is showing pending work, where one path can be listed
   * twice — once staged, once not — and selection has to say which. Views of a
   * commit or a branch range have a single row per path and set this false.
   */
  sided?: boolean;
}

const STATUS_COLORS: Record<GitFileStatus, string> = {
  added: 'text-green-500',
  modified: 'text-blue-500',
  deleted: 'text-red-500',
  renamed: 'text-yellow-500',
};

const SECTION_SPLIT_STORAGE_KEY = 'engy-diffs-section-split';

const STATUS_LABELS: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
};

/**
 * Rows and files are not the same count once a path can be listed on both
 * sides of the index, and anything phrased as a number of files has to say the
 * latter.
 */
const countPaths = (files: ChangedFile[], match: (f: ChangedFile) => boolean = () => true): number =>
  new Set(files.filter(match).map((f) => f.path)).size;

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

    // Tree ids are row ids, so the status letter and the viewed mark are per
    // row — a rename can be staged while a later edit to the same path is not.
    // Comments belong to the file itself, so they stay keyed on the path.
    const path = decodeSelection(item.id, true).path!;
    const status = fileStatusMap.get(item.id);
    const commentCount = commentCounts?.get(path);
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
  sided = false,
}: FileListPanelProps) {
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  // Directories start collapsed and open one level at a time. The set lives here
  // so expand-all can drive every tree at once and so collapse state survives
  // filtering; ids are namespaced per tree, so the staged and unstaged lists
  // still toggle independently.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const statusCounts = useMemo(() => countByStatus(files), [files]);

  const fileCount = useMemo(() => countPaths(files), [files]);

  const commentedCount = useMemo(
    () => countPaths(files, (f) => (commentCounts?.get(f.path) ?? 0) > 0),
    [files, commentCounts],
  );

  // Rows, not paths: each half of a path is reviewed on its own.
  const unviewedCount = useMemo(
    () => files.filter((f) => !viewedPaths?.has(rowId(f))).length,
    [files, viewedPaths],
  );

  const { files: visibleFiles, error: queryError } = useMemo(
    () => filterFiles(files, filter, { commentCounts, viewedPaths }),
    [files, filter, commentCounts, viewedPaths],
  );

  const fileStatusMap = useMemo(() => {
    const map = new Map<string, GitFileStatus>();
    for (const f of files) map.set(rowId(f), f.status);
    return map;
  }, [files]);

  const renderItem = useMemo(
    () => createRenderItem({ fileStatusMap, commentCounts, viewedPaths, onToggleViewed }),
    [fileStatusMap, commentCounts, viewedPaths, onToggleViewed],
  );

  const { stagedItems, unstagedItems, allItems, soleSide, stagedCount, unstagedCount } =
    useMemo(() => {
      const staged = visibleFiles.filter((f) => f.staged).map((f) => f.path);
      const unstaged = visibleFiles.filter((f) => !f.staged).map((f) => f.path);
      const sole: DiffSide = staged.length > 0 && unstaged.length === 0 ? 'staged' : 'unstaged';
      return {
        stagedItems: buildFileTree(staged, selectionPrefix('staged')),
        unstagedItems: buildFileTree(unstaged, selectionPrefix('unstaged')),
        allItems: buildFileTree(
          visibleFiles.map((f) => f.path),
          selectionPrefix(sole),
        ),
        soleSide: sole,
        stagedCount: staged.length,
        unstagedCount: unstaged.length,
      };
    }, [visibleFiles]);

  const {
    fraction: splitFraction,
    isDragging: splitDragging,
    containerRef: splitContainerRef,
    onHandleMouseDown: onSplitMouseDown,
  } = useSectionSplit(SECTION_SPLIT_STORAGE_KEY);
  const [collapsed, setCollapsed] = useState({ staged: false, unstaged: false });
  const toggleSection = (side: DiffSide) =>
    setCollapsed((prev) => ({ ...prev, [side]: !prev[side] }));

  // An empty section has nothing to scroll, so it never claims height either.
  const stagedOpen = !collapsed.staged && stagedCount > 0;
  const unstagedOpen = !collapsed.unstaged && unstagedCount > 0;
  // The divider only means anything while both are competing for height, and
  // only then do the two shares have to add up to the whole pane.
  const bothExpanded = stagedOpen && unstagedOpen;
  const stagedGrow = bothExpanded ? splitFraction : 1;
  const unstagedGrow = bothExpanded ? 1 - splitFraction : 1;

  // Trees always key on side-qualified ids so the same path can sit in both.
  // Callers that don't track a side get the bare path back, and their selection
  // is re-qualified per tree to find the row again.
  const handleSelect = (id: string) => onSelectFile(sided ? id : decodeSelection(id, true).path!);
  const treeSelection = (side: DiffSide) => {
    if (selectedFile === null) return null;
    return sided ? selectedFile : encodeSelection(selectedFile, side);
  };

  const allDirIds = useMemo(
    () =>
      sided
        ? [...collectDirIds(stagedItems), ...collectDirIds(unstagedItems)]
        : collectDirIds(allItems),
    [sided, stagedItems, unstagedItems, allItems],
  );

  const allExpanded = allDirIds.length > 0 && allDirIds.every((id) => expandedIds.has(id));

  const toggleExpandAll = () => setExpandedIds(allExpanded ? new Set() : new Set(allDirIds));

  const filtering = isFilterActive(filter);

  // Bulk marking acts on exactly what the filters leave on screen, so narrowing
  // to a subset and clearing it in one go is the intended workflow.
  const visibleRowIds = useMemo(() => visibleFiles.map(rowId), [visibleFiles]);

  const allVisibleViewed = allViewed(visibleRowIds, viewedPaths ?? new Set());

  const toggleViewedForVisible = () => onSetViewed?.(visibleRowIds, !allVisibleViewed);

  // The panel is rendered on routes without a surrounding provider (the /open
  // quick-diff view), so it supplies its own; nesting providers is safe.
  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">
            {filtering ? `${countPaths(visibleFiles)} of ${fileCount}` : fileCount} file
            {fileCount !== 1 ? 's' : ''} changed
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

        {visibleFiles.length > 0 && !sided && (
          <div className="flex-1 overflow-auto">
            <FileTree
              items={allItems}
              selectedFile={treeSelection(soleSide)}
              onSelectFile={handleSelect}
              renderItem={renderItem}
              expandedIds={expandedIds}
              onExpandedChange={setExpandedIds}
            />
          </div>
        )}

        {visibleFiles.length > 0 && sided && (
          <div ref={splitContainerRef} className="flex min-h-0 flex-1 flex-col">
            <FileTreeSection
              title="Staged"
              count={stagedCount}
              expanded={stagedOpen}
              onToggle={() => toggleSection('staged')}
              grow={stagedGrow}
            >
              <FileTree
                items={stagedItems}
                selectedFile={treeSelection('staged')}
                onSelectFile={handleSelect}
                renderItem={renderItem}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
              />
            </FileTreeSection>

            {bothExpanded && (
              <div
                role="separator"
                aria-orientation="horizontal"
                title="Drag to resize"
                onMouseDown={onSplitMouseDown}
                className={cn(
                  'h-1 shrink-0 cursor-row-resize bg-border transition-colors hover:bg-blue-500',
                  splitDragging && 'bg-blue-500',
                )}
              />
            )}

            <FileTreeSection
              title="Unstaged"
              count={unstagedCount}
              expanded={unstagedOpen}
              onToggle={() => toggleSection('unstaged')}
              grow={unstagedGrow}
            >
              <FileTree
                items={unstagedItems}
                selectedFile={treeSelection('unstaged')}
                onSelectFile={handleSelect}
                renderItem={renderItem}
                expandedIds={expandedIds}
                onExpandedChange={setExpandedIds}
              />
            </FileTreeSection>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
