'use client';

import { useMemo, useState } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import type { TreeRenderItemParams } from '@/components/tree-view';
import { FileTree } from './file-tree';
import { buildFileTree } from './file-tree-model';
import {
  COLLAPSED_BY_DEFAULT,
  FILE_CLASS_LABELS,
  FILE_CLASS_ORDER,
  type FileClass,
} from './file-classes';

interface FileClassGroupsProps {
  paths: string[];
  classes: Map<string, FileClass>;
  idPrefix: string;
  selectedFile: string | null;
  onSelectFile: (id: string) => void;
  renderItem: (params: TreeRenderItemParams) => React.ReactNode;
  expandedIds: Set<string>;
  onExpandedChange: (ids: Set<string>) => void;
}

export function FileClassGroups({
  paths,
  classes,
  idPrefix,
  selectedFile,
  onSelectFile,
  renderItem,
  expandedIds,
  onExpandedChange,
}: FileClassGroupsProps) {
  const [collapsed, setCollapsed] = useState<Set<FileClass>>(new Set(COLLAPSED_BY_DEFAULT));

  const groups = useMemo(
    () =>
      FILE_CLASS_ORDER.map((fileClass) => {
        const classPaths = paths.filter(
          (path) => (classes.get(path) ?? 'implementation') === fileClass,
        );
        return { fileClass, count: classPaths.length, items: buildFileTree(classPaths, idPrefix) };
      }).filter((group) => group.count > 0),
    [paths, classes, idPrefix],
  );

  const toggle = (fileClass: FileClass) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(fileClass)) next.add(fileClass);
      return next;
    });

  return (
    <div className="flex-1 overflow-auto">
      {groups.map(({ fileClass, count, items }) => {
        const isCollapsed = collapsed.has(fileClass);
        return (
          <section key={fileClass}>
            <button
              type="button"
              onClick={() => toggle(fileClass)}
              aria-expanded={!isCollapsed}
              className="flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60 hover:text-foreground"
            >
              {isCollapsed ? (
                <RiArrowRightSLine className="size-3 shrink-0" />
              ) : (
                <RiArrowDownSLine className="size-3 shrink-0" />
              )}
              <span>{FILE_CLASS_LABELS[fileClass]}</span>
              <span className="ml-auto tabular-nums">{count}</span>
            </button>
            {!isCollapsed && (
              <FileTree
                items={items}
                selectedFile={selectedFile}
                onSelectFile={onSelectFile}
                renderItem={renderItem}
                expandedIds={expandedIds}
                onExpandedChange={onExpandedChange}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
