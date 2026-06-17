import type React from 'react';
import type { TreeDataItem } from '@/components/tree-view';
import { RiFile2Line, RiFileTextLine, RiFolderLine, RiImageLine } from '@remixicon/react';
import { fileKind } from '@/lib/file-types';

export type FileEntry = { path: string; mtime: number };
export type SortMode = 'modified' | 'name';
export type SortDir = 'asc' | 'desc';

interface DirNode {
  children: Map<string, DirNode>;
  files: { name: string; path: string; mtime: number }[];
  maxMtime: number;
}

export function buildTrie(files: FileEntry[], dirs: string[]): DirNode {
  const root: DirNode = { children: new Map(), files: [], maxMtime: 0 };

  for (const f of files) {
    const parts = f.path.split('/');
    const fileName = parts.pop()!;
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [], maxMtime: 0 });
      }
      node = node.children.get(segment)!;
      if (f.mtime > node.maxMtime) node.maxMtime = f.mtime;
    }
    node.files.push({ name: fileName, path: f.path, mtime: f.mtime });
    if (f.mtime > root.maxMtime) root.maxMtime = f.mtime;
  }

  for (const d of dirs) {
    const parts = d.split('/');
    let node = root;
    for (const segment of parts) {
      if (!node.children.has(segment)) {
        node.children.set(segment, { children: new Map(), files: [], maxMtime: 0 });
      }
      node = node.children.get(segment)!;
    }
  }

  return root;
}

export function trieToTreeItems(
  node: DirNode,
  parentPath: string,
  sortMode: SortMode,
  sortDir: SortDir,
  dirActions?: (dirPath: string) => React.ReactNode,
  fileActions?: (filePath: string) => React.ReactNode,
  onDirClick?: (dirPath: string) => void,
): TreeDataItem[] {
  const sortMul = sortDir === 'asc' ? 1 : -1;

  const sortedFiles = [...node.files].sort((a, b) => {
    if (sortMode === 'modified') return (a.mtime - b.mtime) * sortMul;
    return a.name.localeCompare(b.name) * sortMul;
  });

  const fileItems: TreeDataItem[] = sortedFiles.map((f) => {
    const kind = fileKind(f.name);
    const icon = kind === 'image' ? RiImageLine : kind === 'binary' ? RiFile2Line : RiFileTextLine;
    return {
      id: f.path,
      name: f.name,
      icon,
      actions: fileActions?.(f.path),
    };
  });

  const dirEntries = [...node.children.entries()];
  if (sortMode === 'modified') {
    dirEntries.sort((a, b) => (a[1].maxMtime - b[1].maxMtime) * sortMul);
  } else {
    dirEntries.sort((a, b) => a[0].localeCompare(b[0]) * sortMul);
  }

  const dirItems: TreeDataItem[] = dirEntries.map(([dirName, dirNode]) => {
    const dirPath = parentPath ? `${parentPath}/${dirName}` : dirName;
    return {
      id: `dir:${dirPath}`,
      name: dirName,
      icon: RiFolderLine,
      children: trieToTreeItems(dirNode, dirPath, sortMode, sortDir, dirActions, fileActions, onDirClick),
      actions: dirActions?.(dirPath),
      onClick: onDirClick ? () => onDirClick(dirPath) : undefined,
    };
  });

  return [...dirItems, ...fileItems];
}

export function parentPrefix(itemPath: string): string {
  const idx = itemPath.lastIndexOf('/');
  return idx >= 0 ? itemPath.substring(0, idx + 1) : '';
}

export function buildFileTree(
  files: FileEntry[],
  dirs: string[],
  sortMode: SortMode,
  sortDir: SortDir,
  filterText: string,
  dirActions?: (dirPath: string) => React.ReactNode,
  fileActions?: (filePath: string) => React.ReactNode,
  onDirClick?: (dirPath: string) => void,
): TreeDataItem[] {
  const lowerFilter = filterText.toLowerCase();
  const filtered = lowerFilter
    ? files.filter((f) => f.path.toLowerCase().includes(lowerFilter))
    : files;

  const filteredDirs = lowerFilter
    ? dirs.filter((d) => d.toLowerCase().includes(lowerFilter))
    : dirs;

  const root = buildTrie(filtered, filteredDirs);
  return trieToTreeItems(root, '', sortMode, sortDir, dirActions, fileActions, onDirClick);
}

export function applyDefaultExtension(name: string, ext: string | undefined): string {
  if (!ext) return name;
  return name.endsWith(ext) ? name : `${name}${ext}`;
}
