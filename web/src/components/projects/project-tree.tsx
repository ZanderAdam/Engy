"use client";

import { useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { FileTree } from "@/components/file-tree";

interface ProjectTreeProps {
  workspaceSlug: string;
  projectSlug: string;
  selectedFile: string | null;
  onSelectFile: (filePath: string) => void;
}

export function ProjectTree({
  workspaceSlug,
  projectSlug,
  selectedFile,
  onSelectFile,
}: ProjectTreeProps) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.project.listFiles.useQuery({
    workspaceSlug,
    projectSlug,
  });

  const writeMutation = trpc.project.writeFile.useMutation({
    onSuccess: () => utils.project.listFiles.invalidate({ workspaceSlug, projectSlug }),
  });

  const mkdirMutation = trpc.project.mkdir.useMutation({
    onSuccess: () => utils.project.listFiles.invalidate({ workspaceSlug, projectSlug }),
  });

  const deleteFileMutation = trpc.project.deleteFile.useMutation({
    onSuccess: () => utils.project.listFiles.invalidate({ workspaceSlug, projectSlug }),
  });

  const deleteDirMutation = trpc.project.deleteDir.useMutation({
    onSuccess: () => utils.project.listFiles.invalidate({ workspaceSlug, projectSlug }),
  });

  const renameFileMutation = trpc.project.renameFile.useMutation({
    onSuccess: () => utils.project.listFiles.invalidate({ workspaceSlug, projectSlug }),
  });

  const renameDirMutation = trpc.project.renameDir.useMutation({
    onSuccess: () => utils.project.listFiles.invalidate({ workspaceSlug, projectSlug }),
  });

  const handleCreateFile = useCallback(
    (relDir: string, fileName: string) => {
      const filePath = relDir ? `${relDir}/${fileName}` : fileName;
      writeMutation.mutate(
        { workspaceSlug, projectSlug, filePath, content: "" },
        { onSuccess: () => onSelectFile(filePath) },
      );
    },
    [writeMutation, workspaceSlug, projectSlug, onSelectFile],
  );

  const handleCreateDir = useCallback(
    (subDir: string) => {
      mkdirMutation.mutate({ workspaceSlug, projectSlug, subDir });
    },
    [mkdirMutation, workspaceSlug, projectSlug],
  );

  const handleDeleteFile = useCallback(
    (filePath: string) => {
      deleteFileMutation.mutate(
        { workspaceSlug, projectSlug, filePath },
        { onSuccess: () => { if (selectedFile === filePath) onSelectFile(''); } },
      );
    },
    [deleteFileMutation, workspaceSlug, projectSlug, selectedFile, onSelectFile],
  );

  const handleDeleteDir = useCallback(
    (subDir: string) => {
      deleteDirMutation.mutate({ workspaceSlug, projectSlug, subDir });
    },
    [deleteDirMutation, workspaceSlug, projectSlug],
  );

  const handleRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      renameFileMutation.mutate(
        { workspaceSlug, projectSlug, oldPath, newPath },
        { onSuccess: () => { if (selectedFile === oldPath) onSelectFile(newPath); } },
      );
    },
    [renameFileMutation, workspaceSlug, projectSlug, selectedFile, onSelectFile],
  );

  const handleRenameDir = useCallback(
    (oldSubDir: string, newSubDir: string) => {
      renameDirMutation.mutate(
        { workspaceSlug, projectSlug, oldSubDir, newSubDir },
        {
          onSuccess: () => {
            if (selectedFile?.startsWith(`${oldSubDir}/`)) {
              onSelectFile(selectedFile.replace(`${oldSubDir}/`, `${newSubDir}/`));
            }
          },
        },
      );
    },
    [renameDirMutation, workspaceSlug, projectSlug, selectedFile, onSelectFile],
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
      onCreateFile={handleCreateFile}
      onCreateDir={handleCreateDir}
      onDeleteFile={handleDeleteFile}
      onDeleteDir={handleDeleteDir}
      onRenameFile={handleRenameFile}
      onRenameDir={handleRenameDir}
    />
  );
}
