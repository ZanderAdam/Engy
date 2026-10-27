'use client';

import { useState, type ReactNode } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import type { TreeDataItem, TreeRenderItemParams } from '@/components/tree-view';
import { FileTree } from './file-tree';
import { revealGroupOf, type FileGroupPaths } from './file-groups-model';

export interface FileGroup extends FileGroupPaths {
  label: ReactNode;
  items: TreeDataItem[];
}

interface FileGroupsProps {
  groups: FileGroup[];
  defaultCollapsed: ReadonlySet<string>;
  idPrefix: string;
  selectedFile: string | null;
  onSelectFile: (id: string) => void;
  renderItem: (params: TreeRenderItemParams) => ReactNode;
  expandedIds: Set<string>;
  onExpandedChange: (ids: Set<string>) => void;
}

export function FileGroups({
  groups,
  defaultCollapsed,
  idPrefix,
  selectedFile,
  onSelectFile,
  renderItem,
  expandedIds,
  onExpandedChange,
}: FileGroupsProps) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(defaultCollapsed);

  const [revealedFile, setRevealedFile] = useState<string | null>(null);
  if (selectedFile !== revealedFile) {
    setRevealedFile(selectedFile);
    setCollapsed(revealGroupOf(collapsed, selectedFile, idPrefix, groups));
  }

  const toggle = (id: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  return (
    <div className="flex-1 overflow-auto">
      {groups.map(({ id, label, paths, items }) => {
        const isCollapsed = collapsed.has(id);
        return (
          <section key={id} data-file-group={id}>
            <button
              type="button"
              onClick={() => toggle(id)}
              aria-expanded={!isCollapsed}
              className="flex w-full cursor-pointer items-center gap-1 px-2 py-1 text-left text-[10px] font-medium text-muted-foreground/60 hover:text-foreground"
            >
              {isCollapsed ? (
                <RiArrowRightSLine className="size-3 shrink-0" />
              ) : (
                <RiArrowDownSLine className="size-3 shrink-0" />
              )}
              {label}
              <span className="ml-auto shrink-0 pl-1 tabular-nums">{paths.length}</span>
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
