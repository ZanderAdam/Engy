'use client';

import { RiFolderLine } from '@remixicon/react';
import {
  TreeView,
  type TreeDataItem,
  type TreeRenderItemParams,
} from '@/components/tree-view';

interface FileTreeProps {
  items: TreeDataItem[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  renderItem?: (params: TreeRenderItemParams) => React.ReactNode;
  expandedIds: Set<string>;
  onExpandedChange: (ids: Set<string>) => void;
}

function DefaultRenderItem({ item, isLeaf }: TreeRenderItemParams) {
  if (!isLeaf) {
    return (
      <>
        <RiFolderLine className="h-4 w-4 shrink-0 mr-2 text-muted-foreground" />
        <span className="text-sm truncate">{item.name}</span>
      </>
    );
  }
  return <span className="text-sm truncate">{item.name}</span>;
}

export function FileTree({
  items,
  selectedFile,
  onSelectFile,
  renderItem,
  expandedIds,
  onExpandedChange,
}: FileTreeProps) {
  if (items.length === 0) return null;

  return (
    <div className="[&_.ml-4]:ml-1.5 [&_.ml-5]:ml-0.5 [&_.pl-1]:pl-0.5">
      <TreeView
        data={items}
        initialSelectedItemId={selectedFile ?? undefined}
        onSelectChange={(item) => {
          if (item && !item.children) onSelectFile(item.id);
        }}
        expandedIds={expandedIds}
        onExpandedChange={onExpandedChange}
        renderItem={renderItem ?? DefaultRenderItem}
      />
    </div>
  );
}
