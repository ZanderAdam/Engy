'use client';

import { useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { FileTree } from '@/components/file-tree';

interface EditableFileTreeProps {
  dirPath: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

export function EditableFileTree({
  dirPath,
  selectedFile,
  onSelectFile,
}: EditableFileTreeProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.dir.listFiles.useQuery({ dirPath });

  const writeMutation = trpc.dir.write.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath }),
  });

  const mkdirMutation = trpc.dir.mkdir.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath }),
  });

  const deleteFileMutation = trpc.dir.deleteFile.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath }),
  });

  const deleteDirMutation = trpc.dir.deleteDir.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath }),
  });

  const renameFileMutation = trpc.dir.renameFile.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath }),
  });

  const renameDirMutation = trpc.dir.renameDir.useMutation({
    onSuccess: () => utils.dir.listFiles.invalidate({ dirPath }),
  });

  const handleCreateFile = useCallback(
    (relDir: string, fileName: string) => {
      const filePath = relDir ? `${relDir}/${fileName}` : fileName;
      writeMutation.mutate(
        { dirPath, filePath, content: '' },
        { onSuccess: () => onSelectFile(filePath) },
      );
    },
    [writeMutation, dirPath, onSelectFile],
  );

  const handleCreateDir = useCallback(
    (subDir: string) => {
      mkdirMutation.mutate({ dirPath, subDir });
    },
    [mkdirMutation, dirPath],
  );

  const handleDeleteFile = useCallback(
    (filePath: string) => {
      deleteFileMutation.mutate(
        { dirPath, filePath },
        {
          onSuccess: () => {
            if (selectedFile === filePath) onSelectFile('');
          },
        },
      );
    },
    [deleteFileMutation, dirPath, selectedFile, onSelectFile],
  );

  const handleDeleteDir = useCallback(
    (subDir: string) => {
      deleteDirMutation.mutate({ dirPath, subDir });
    },
    [deleteDirMutation, dirPath],
  );

  const handleRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      renameFileMutation.mutate(
        { dirPath, oldPath, newPath },
        {
          onSuccess: () => {
            if (selectedFile === oldPath) onSelectFile(newPath);
          },
        },
      );
    },
    [renameFileMutation, dirPath, selectedFile, onSelectFile],
  );

  const handleRenameDir = useCallback(
    (oldSubDir: string, newSubDir: string) => {
      renameDirMutation.mutate(
        { dirPath, oldSubDir, newSubDir },
        {
          onSuccess: () => {
            if (selectedFile?.startsWith(`${oldSubDir}/`)) {
              onSelectFile(selectedFile.replace(`${oldSubDir}/`, `${newSubDir}/`));
            }
          },
        },
      );
    },
    [renameDirMutation, dirPath, selectedFile, onSelectFile],
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <p className="text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <FileTree
      files={data?.files ?? []}
      dirs={data?.dirs ?? []}
      selectedFile={selectedFile}
      onSelectFile={onSelectFile}
      rootAbsPath={dirPath}
      onCreateFile={handleCreateFile}
      onCreateDir={handleCreateDir}
      onDeleteFile={handleDeleteFile}
      onDeleteDir={handleDeleteDir}
      onRenameFile={handleRenameFile}
      onRenameDir={handleRenameDir}
    />
  );
}
