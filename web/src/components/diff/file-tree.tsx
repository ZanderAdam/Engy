'use client';

import { useEffect, useMemo, useState } from 'react';
import { RiFolderLine, RiSearchLine } from '@remixicon/react';
import { ChevronRight } from 'lucide-react';
import { TreeView, type TreeDataItem, type TreeRenderItemParams } from '@/components/tree-view';
import { cn } from '@/lib/utils';

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

// ── Lazy-loaded file tree (fetches directory contents on demand) ─────────────

interface LazyFileTreeProps {
  rootDir: string;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  listDir: (dirPath: string) => Promise<{ dirs: string[]; files: string[] }>;
  searchFiles: (query: string) => Promise<{ label: string; path: string }[]>;
}

interface DirEntry {
  dirs: string[];
  files: string[];
}

export function LazyFileTree({
  rootDir,
  selectedFile,
  onSelectFile,
  listDir,
  searchFiles,
}: LazyFileTreeProps) {
  const [expandedDirs, setExpandedDirs] = useState<Map<string, DirEntry>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ label: string; path: string }[] | null>(
    null,
  );
  const [isSearching, setIsSearching] = useState(false);

  // Reset and load root on rootDir change (derived state pattern)
  const [loadedRoot, setLoadedRoot] = useState<string | null>(null);
  if (loadedRoot !== rootDir) {
    setLoadedRoot(rootDir);
    setExpandedDirs(new Map());
    setLoadingDirs(new Set([rootDir]));
  }

  useEffect(() => {
    let cancelled = false;
    listDir(rootDir).then((result) => {
      if (cancelled) return;
      setExpandedDirs(new Map([[rootDir, result]]));
      setLoadingDirs(new Set());
    });
    return () => { cancelled = true; };
  }, [rootDir, listDir]);

  const handleToggleDir = async (dirPath: string) => {
    if (expandedDirs.has(dirPath)) {
      setExpandedDirs((prev) => {
        const next = new Map(prev);
        next.delete(dirPath);
        return next;
      });
      return;
    }
    setLoadingDirs((prev) => new Set(prev).add(dirPath));
    const result = await listDir(dirPath);
    setExpandedDirs((prev) => new Map(prev).set(dirPath, result));
    setLoadingDirs((prev) => {
      const next = new Set(prev);
      next.delete(dirPath);
      return next;
    });
  };

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }
    setIsSearching(true);
    const results = await searchFiles(query);
    setSearchResults(results);
    setIsSearching(false);
  };

  // If searching, show flat search results using FileTree
  if (searchResults !== null && searchQuery.trim()) {
    const paths = searchResults.map((r) => r.path);
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
          <RiSearchLine className="size-3 shrink-0 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search files..."
            className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
          />
        </div>
        {isSearching ? (
          <p className="p-3 text-xs text-muted-foreground">Searching...</p>
        ) : (
          <FileTree
            filePaths={paths}
            selectedFile={selectedFile}
            onSelectFile={onSelectFile}
            showFilter={false}
          />
        )}
      </div>
    );
  }

  // Normal lazy tree
  const rootEntry = expandedDirs.get(rootDir);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1.5 border-b border-border px-2 py-1">
        <RiSearchLine className="size-3 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search files..."
          className="h-5 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
        />
      </div>
      <div className="flex-1 overflow-auto">
        {!rootEntry ? (
          <p className="p-3 text-xs text-muted-foreground">Loading...</p>
        ) : (
          <LazyDirContents
            dirPath={rootDir}
            entry={rootEntry}
            expandedDirs={expandedDirs}
            loadingDirs={loadingDirs}
            selectedFile={selectedFile}
            onToggleDir={handleToggleDir}
            onSelectFile={onSelectFile}
            depth={0}
          />
        )}
      </div>
    </div>
  );
}

function LazyDirContents({
  dirPath,
  entry,
  expandedDirs,
  loadingDirs,
  selectedFile,
  onToggleDir,
  onSelectFile,
  depth,
}: {
  dirPath: string;
  entry: DirEntry;
  expandedDirs: Map<string, DirEntry>;
  loadingDirs: Set<string>;
  selectedFile: string | null;
  onToggleDir: (dirPath: string) => void;
  onSelectFile: (path: string) => void;
  depth: number;
}) {
  const indent = depth * 12;

  return (
    <div>
      {entry.dirs.map((dir) => {
        const fullPath = `${dirPath.replace(/\/$/, '')}/${dir}`;
        const isExpanded = expandedDirs.has(fullPath);
        const isLoading = loadingDirs.has(fullPath);
        const childEntry = expandedDirs.get(fullPath);

        return (
          <div key={dir}>
            <button
              className="flex w-full items-center gap-1 px-2 py-0.5 text-left hover:bg-muted/50"
              style={{ paddingLeft: `${indent + 8}px` }}
              onClick={() => onToggleDir(fullPath)}
            >
              <ChevronRight
                className={cn(
                  'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                  isExpanded && 'rotate-90',
                  isLoading && 'animate-spin',
                )}
              />
              <RiFolderLine className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm truncate">{dir}</span>
            </button>
            {isExpanded && childEntry && (
              <LazyDirContents
                dirPath={fullPath}
                entry={childEntry}
                expandedDirs={expandedDirs}
                loadingDirs={loadingDirs}
                selectedFile={selectedFile}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
      {entry.files.map((file) => {
        const fullPath = `${dirPath.replace(/\/$/, '')}/${file}`;
        const isSelected = selectedFile === fullPath;
        return (
          <button
            key={file}
            className={`flex w-full items-center px-2 py-0.5 text-left hover:bg-muted/50 ${
              isSelected ? 'bg-muted text-foreground' : ''
            }`}
            style={{ paddingLeft: `${indent + 22}px` }}
            onClick={() => onSelectFile(fullPath)}
          >
            <span className="text-sm truncate">{file}</span>
          </button>
        );
      })}
    </div>
  );
}
