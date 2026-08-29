'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1_000;

/**
 * Executes a pending debounced save immediately. Exported for testing.
 */
export function flushTimer(
  timerRef: React.RefObject<ReturnType<typeof setTimeout> | null>,
  pendingSaveRef: React.RefObject<(() => void) | null>,
) {
  if (timerRef.current !== null) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingSaveRef.current?.();
    pendingSaveRef.current = null;
  }
}

export function useAutoSave(
  repoDir: string | null,
  filePath: string | null,
  worktreePath?: string,
  coderWorkspace?: string,
) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const lastSavedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Stores the flush function for the currently-pending debounced save.
  const pendingSaveRef = useRef<(() => void) | null>(null);
  // Chains writes so they always land in order.
  const writeChainRef = useRef<Promise<void>>(Promise.resolve());
  // Sequence counter — only the latest write updates status.
  const writeSeqRef = useRef(0);

  // A save changes what the working tree holds, which is the "after" side of
  // every diff on screen and the identity the file list reports for the path.
  // Without this the list keeps describing the file as it was before the edit.
  const utils = trpc.useUtils();
  const writeMutation = trpc.file.write.useMutation({
    onSuccess: () => {
      void utils.diff.getStatus.invalidate();
    },
  });
  const mutateRef = useRef(writeMutation.mutateAsync);
  useEffect(() => {
    mutateRef.current = writeMutation.mutateAsync;
  }, [writeMutation.mutateAsync]);
  const [resetKey, setResetKey] = useState(`${repoDir}:${filePath}`);

  // Detect file change via derived state
  const currentKey = `${repoDir}:${filePath}`;
  if (currentKey !== resetKey) {
    setResetKey(currentKey);
    setStatus('idle');
  }

  // On file change: flush any pending save for the OLD file, then reset refs.
  useEffect(() => {
    flushTimer(timerRef, pendingSaveRef);
    lastSavedRef.current = null;
  }, [resetKey]);

  // On unmount: flush any pending save.
  useEffect(() => {
    return () => {
      flushTimer(timerRef, pendingSaveRef);
    };
  }, []);

  const save = useCallback(
    (content: string) => {
      if (!repoDir || !filePath) return;
      if (content === lastSavedRef.current) return;

      // Cancel any existing timer.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingSaveRef.current = null;
      }

      // Capture stable references for the closure.
      const capturedRepoDir = repoDir;
      const capturedFilePath = filePath;
      const capturedContent = content;
      const capturedWorktreePath = worktreePath;
      const capturedCoderWorkspace = coderWorkspace;

      const doSave = () => {
        const seq = ++writeSeqRef.current;
        setStatus('saving');
        writeChainRef.current = writeChainRef.current.then(async () => {
          // Skip if a newer write has already been enqueued.
          if (seq < writeSeqRef.current) return;
          try {
            await mutateRef.current({
              repoDir: capturedRepoDir,
              filePath: capturedFilePath,
              content: capturedContent,
              worktreePath: capturedWorktreePath,
              coderWorkspace: capturedCoderWorkspace,
            });
            if (seq === writeSeqRef.current) {
              lastSavedRef.current = capturedContent;
              setStatus('saved');
            }
          } catch {
            if (seq === writeSeqRef.current) {
              setStatus('error');
            }
          }
        });
      };

      pendingSaveRef.current = doSave;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        pendingSaveRef.current = null;
        doSave();
      }, DEBOUNCE_MS);
    },
    [repoDir, filePath, worktreePath, coderWorkspace],
  );

  return { status, save };
}
