'use client';

import { useMemo, useState } from 'react';
import { RiFolderLine, RiSearchLine } from '@remixicon/react';
import { TreeView, type TreeDataItem, type TreeRenderItemParams } from '@/components/tree-view';

// ── Static file tree (from a known list of file paths) ──────────────────────

interface TrieNode {
  children: Map<string, TrieNode>;
  files: string[];
}

function buildTrie(filePaths: string[]): TrieNode {
  const root: TrieNode = { children: new Map(), files: [] };
  for (const filePath of [...filePaths].sort((a, b) => a.localeCompare(b))) {
    const parts = filePath.split('/');
    parts.pop();
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [] });
      }
      node = node.children.get(segment)!;
    }
    node.files.push(filePath);
  }
  return root;
}

function trieToTreeItems(node: TrieNode, parentPath: string): TreeDataItem[] {
  const dirEntries = [...node.children.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const dirItems: TreeDataItem[] = dirEntries.map(([dirName, dirNode]) => {
    let compactedName = dirName;
    let compactedPath = parentPath ? `${parentPath}/${dirName}` : dirName;
    let current = dirNode;

    while (current.children.size === 1 && current.files.length === 0) {
      const [childName, childNode] = current.children.entries().next().value!;
      compactedName = `${compactedName}/${childName}`;
      compactedPath = `${compactedPath}/${childName}`;
      current = childNode;
    }

    return {
      id: `dir:${compactedPath}`,
      name: compactedName,
      children: trieToTreeItems(current, compactedPath),
    };
  });

  const fileItems: TreeDataItem[] = node.files.map((filePath) => ({
    id: filePath,
    name: filePath.split('/').pop() ?? filePath,
  }));

  return [...dirItems, ...fileItems];
}

interface FileTreeProps {
  filePaths: string[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  renderItem?: (params: TreeRenderItemParams) => React.ReactNode;
  showFilter?: boolean;
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
  filePaths,
  selectedFile,
  onSelectFile,
  renderItem,
  showFilter = true,
}: FileTreeProps) {
  const [filter, setFilter] = useState('');

  const filtered = useMemo(() => {
    if (!filter) return filePaths;
    const q = filter.toLowerCase();
    return filePaths.filter((p) => p.toLowerCase().includes(q));
  }, [filePaths, filter]);

  const treeData = useMemo(() => {
    const root = buildTrie(filtered);
    return trieToTreeItems(root, '');
  }, [filtered]);

  return (
    <div className="flex flex-col">
      {showFilter && filePaths.length > 5 && (
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

      {treeData.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="text-xs text-muted-foreground">No files</p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto [&_.ml-4]:ml-1.5 [&_.ml-5]:ml-0.5 [&_.pl-1]:pl-0.5">
          <TreeView
            data={treeData}
            initialSelectedItemId={selectedFile ?? undefined}
            onSelectChange={(item) => {
              if (item && !item.children) onSelectFile(item.id);
            }}
            expandAll
            renderItem={renderItem ?? DefaultRenderItem}
          />
        </div>
      )}
    </div>
  );
}

