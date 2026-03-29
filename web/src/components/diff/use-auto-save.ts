'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { trpc } from '@/lib/trpc';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

const DEBOUNCE_MS = 1_000;

export function useAutoSave(repoDir: string | null, filePath: string | null) {
  const [status, setStatus] = useState<SaveStatus>('idle');
  const lastSavedRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeMutation = trpc.file.write.useMutation();
  const mutateRef = useRef(writeMutation.mutateAsync);
  useEffect(() => { mutateRef.current = writeMutation.mutateAsync; }, [writeMutation.mutateAsync]);
  const [resetKey, setResetKey] = useState(`${repoDir}:${filePath}`);

  // Detect file change via derived state
  const currentKey = `${repoDir}:${filePath}`;
  if (currentKey !== resetKey) {
    setResetKey(currentKey);
    setStatus('idle');
  }

  // Clean up timer and refs when file changes
  useEffect(() => {
    lastSavedRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [resetKey]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const save = useCallback(
    (content: string) => {
      if (!repoDir || !filePath) return;
      if (content === lastSavedRef.current) return;

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(async () => {
        timerRef.current = null;
        setStatus('saving');
        try {
          await mutateRef.current({ repoDir, filePath, content });
          lastSavedRef.current = content;
          setStatus('saved');
        } catch {
          setStatus('error');
        }
      }, DEBOUNCE_MS);
    },
    [repoDir, filePath],
  );

  return { status, save };
}
