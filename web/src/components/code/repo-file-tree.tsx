'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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

// Repo files have no docs-style image restriction — everything is manageable.
const allFilesManageable = () => true;

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

  const loadDir = useCallback(
    async (relDir: string) => {
      const result = await trpcUtils.file.listDir.fetch({
        dirPath: relDir ? `${rootDir}/${relDir}` : rootDir,
      });
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

  // The owner remounts this component per root (key={rootDir}), so loaded
  // state never spans two roots and this effect runs once per instance.
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
        { rootDir, relPath: relSubDir },
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
      canManageFile={allFilesManageable}
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
