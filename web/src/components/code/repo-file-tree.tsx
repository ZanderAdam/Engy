'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { toast } from 'sonner';
import { FileTree } from '@/components/file-tree';
import {
  flattenLoadedDirs,
  joinRel,
  parentRelDir,
  pruneLoadedDirs,
  toRelPath,
  type LoadedDir,
} from './repo-file-tree-helpers';

interface RepoFileTreeProps {
  /** Worktree-effective absolute root the tree reads from. */
  rootDir: string;
  /** Main repo path — preserved as the write identity (same convention as file.read). */
  repoDir: string;
  worktreePath?: string;
  /** Selected file path relative to rootDir. */
  selectedFile: string | null;
  onSelectFile: (relPath: string) => void;
}

function showError(error: { message: string }): void {
  toast.error(error.message);
}

export function RepoFileTree({
  rootDir,
  repoDir,
  worktreePath,
  selectedFile,
  onSelectFile,
}: RepoFileTreeProps) {
  const trpcUtils = trpc.useUtils();
  const [loaded, setLoaded] = useState<Map<string, LoadedDir>>(new Map());
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Guards against a stale in-flight load landing after the user switched roots.
  const rootRef = useRef(rootDir);
  rootRef.current = rootDir;

  const loadDir = useCallback(
    async (relDir: string) => {
      const root = rootDir;
      const result = await trpcUtils.file.listDir.fetch({
        dirPath: relDir ? `${root}/${relDir}` : root,
      });
      if (rootRef.current !== root) return;
      setLoaded((prev) => new Map(prev).set(relDir, result));
    },
    [trpcUtils, rootDir],
  );

  const refreshDir = useCallback(
    async (relDir: string) => {
      const dirPath = relDir ? `${rootDir}/${relDir}` : rootDir;
      await trpcUtils.file.listDir.invalidate({ dirPath });
      await loadDir(relDir);
    },
    [trpcUtils, rootDir, loadDir],
  );

  // Reset and reload when the root changes (derived state pattern)
  const [prevRoot, setPrevRoot] = useState(rootDir);
  if (prevRoot !== rootDir) {
    setPrevRoot(rootDir);
    setLoaded(new Map());
  }

  useEffect(() => {
    loadDir('').catch(showError);
  }, [loadDir]);

  const { files, dirs } = useMemo(() => flattenLoadedDirs(loaded), [loaded]);

  const handleDirClick = useCallback(
    (relDir: string) => {
      if (!loaded.has(relDir)) loadDir(relDir).catch(showError);
    },
    [loaded, loadDir],
  );

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setLoaded(new Map());
    try {
      await trpcUtils.file.listDir.invalidate();
      await loadDir('');
    } catch (err) {
      showError(err as Error);
    } finally {
      setIsRefreshing(false);
    }
  }, [trpcUtils, loadDir]);

  const searchFiles = useCallback(
    async (query: string) => {
      const result = await trpcUtils.dir.searchRepoFiles.fetch({
        dirs: [rootDir],
        query,
        limit: 50,
      });
      return result.results.map((r) => toRelPath(r.path, rootDir));
    },
    [trpcUtils, rootDir],
  );

  const writeMutation = trpc.file.write.useMutation({ onError: showError });
  const createDirMutation = trpc.file.createDir.useMutation({ onError: showError });
  const deleteMutation = trpc.file.deleteEntry.useMutation({ onError: showError });
  const renameMutation = trpc.file.renameEntry.useMutation({ onError: showError });

  const handleCreateFile = useCallback(
    (relDir: string, fileName: string) => {
      const relPath = joinRel(relDir, fileName);
      writeMutation.mutate(
        { repoDir, filePath: relPath, content: '', worktreePath },
        {
          onSuccess: () => {
            void refreshDir(relDir);
            onSelectFile(relPath);
          },
        },
      );
    },
    [writeMutation, repoDir, worktreePath, refreshDir, onSelectFile],
  );

  const handleCreateDir = useCallback(
    (relSubDir: string) => {
      createDirMutation.mutate(
        { dirPath: `${rootDir}/${relSubDir}` },
        { onSuccess: () => void refreshDir(parentRelDir(relSubDir)) },
      );
    },
    [createDirMutation, rootDir, refreshDir],
  );

  const handleDeleteFile = useCallback(
    (relPath: string) => {
      deleteMutation.mutate(
        { rootDir, relPath },
        {
          onSuccess: () => {
            void refreshDir(parentRelDir(relPath));
            if (selectedFile === relPath) onSelectFile('');
          },
        },
      );
    },
    [deleteMutation, rootDir, refreshDir, selectedFile, onSelectFile],
  );

  const handleDeleteDir = useCallback(
    (relPath: string) => {
      deleteMutation.mutate(
        { rootDir, relPath },
        {
          onSuccess: () => {
            setLoaded((prev) => pruneLoadedDirs(prev, relPath));
            void refreshDir(parentRelDir(relPath));
            if (selectedFile?.startsWith(`${relPath}/`)) onSelectFile('');
          },
        },
      );
    },
    [deleteMutation, rootDir, refreshDir, selectedFile, onSelectFile],
  );

  const handleRenameFile = useCallback(
    (oldRelPath: string, newRelPath: string) => {
      renameMutation.mutate(
        { rootDir, oldRelPath, newRelPath },
        {
          onSuccess: () => {
            void refreshDir(parentRelDir(oldRelPath));
            if (selectedFile === oldRelPath) onSelectFile(newRelPath);
          },
        },
      );
    },
    [renameMutation, rootDir, refreshDir, selectedFile, onSelectFile],
  );

  const handleRenameDir = useCallback(
    (oldRelPath: string, newRelPath: string) => {
      renameMutation.mutate(
        { rootDir, oldRelPath, newRelPath },
        {
          onSuccess: () => {
            setLoaded((prev) => pruneLoadedDirs(prev, oldRelPath));
            void refreshDir(parentRelDir(oldRelPath));
            if (selectedFile?.startsWith(`${oldRelPath}/`)) {
              onSelectFile(`${newRelPath}${selectedFile.slice(oldRelPath.length)}`);
            }
          },
        },
      );
    },
    [renameMutation, rootDir, refreshDir, selectedFile, onSelectFile],
  );

  return (
    <FileTree
      files={files}
      dirs={dirs}
      selectedFile={selectedFile}
      onSelectFile={onSelectFile}
      rootAbsPath={rootDir}
      onDirClick={handleDirClick}
      searchFiles={searchFiles}
      canManageFile={() => true}
      onCreateFile={handleCreateFile}
      onCreateDir={handleCreateDir}
      onDeleteFile={handleDeleteFile}
      onDeleteDir={handleDeleteDir}
      onRenameFile={handleRenameFile}
      onRenameDir={handleRenameDir}
      onRefresh={() => void handleRefresh()}
      isRefreshing={isRefreshing}
    />
  );
}
