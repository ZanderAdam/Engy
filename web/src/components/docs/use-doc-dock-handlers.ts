import { useCallback, type RefObject } from 'react';
import type { DocDockHandle } from './doc-dock-manager';

interface DocDockHandlers {
  onSelectFile: (file: string) => void;
  onRenameFile: (oldPath: string, newPath: string) => void;
  onDeleteFile: (filePath: string) => void;
  onRenameDir: (oldSubDir: string, newSubDir: string) => void;
  onDeleteDir: (subDir: string) => void;
}

export function useDocDockHandlers(
  dockRef: RefObject<DocDockHandle | null>,
  options?: { onAfterSelect?: () => void },
): DocDockHandlers {
  const onAfterSelect = options?.onAfterSelect;

  const onSelectFile = useCallback(
    (file: string) => {
      if (!file) return;
      dockRef.current?.openDoc(file);
      onAfterSelect?.();
    },
    [dockRef, onAfterSelect],
  );

  const onRenameFile = useCallback(
    (oldPath: string, newPath: string) => {
      dockRef.current?.renameDoc(oldPath, newPath);
    },
    [dockRef],
  );

  const onDeleteFile = useCallback(
    (filePath: string) => {
      dockRef.current?.closeDoc(filePath);
    },
    [dockRef],
  );

  const onRenameDir = useCallback(
    (oldSubDir: string, newSubDir: string) => {
      dockRef.current?.renameDocsUnder(oldSubDir, newSubDir);
    },
    [dockRef],
  );

  const onDeleteDir = useCallback(
    (subDir: string) => {
      dockRef.current?.closeDocsUnder(subDir);
    },
    [dockRef],
  );

  return { onSelectFile, onRenameFile, onDeleteFile, onRenameDir, onDeleteDir };
}
