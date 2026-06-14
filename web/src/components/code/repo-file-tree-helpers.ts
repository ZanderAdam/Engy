import type { FileEntry } from '@/components/file-tree-helpers';

export interface LoadedDir {
  dirs: string[];
  files: { name: string; mtime: number }[];
}

export function joinRel(relDir: string, name: string): string {
  return relDir ? `${relDir}/${name}` : name;
}

export function parentRelDir(relPath: string): string {
  const idx = relPath.lastIndexOf('/');
  return idx >= 0 ? relPath.slice(0, idx) : '';
}

export function toRelPath(path: string, rootDir: string): string {
  const prefix = rootDir.endsWith('/') ? rootDir : `${rootDir}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : path;
}

export function flattenLoadedDirs(loaded: Map<string, LoadedDir>): {
  files: FileEntry[];
  dirs: string[];
} {
  const files: FileEntry[] = [];
  const dirs: string[] = [];
  for (const [relDir, entry] of loaded) {
    for (const dir of entry.dirs) dirs.push(joinRel(relDir, dir));
    for (const file of entry.files) {
      files.push({ path: joinRel(relDir, file.name), mtime: file.mtime });
    }
  }
  return { files, dirs };
}

export function pruneLoadedDirs(
  loaded: Map<string, LoadedDir>,
  relPath: string,
): Map<string, LoadedDir> {
  const next = new Map<string, LoadedDir>();
  for (const [key, value] of loaded) {
    if (key === relPath || key.startsWith(`${relPath}/`)) continue;
    next.set(key, value);
  }
  return next;
}
