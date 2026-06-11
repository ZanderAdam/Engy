'use client';

import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

export function collectDirPaths(repos: string[], docsDir: string): string[] {
  const filteredRepos = repos.map((r) => r.trim()).filter((r) => r !== '');
  const trimmedDocsDir = docsDir.trim();
  return [...new Set([...filteredRepos, ...(trimmedDocsDir ? [trimmedDocsDir] : [])])];
}

interface UseConfirmCreateDirsOptions {
  /** Runs the dialog's mutation; receives whether missing dirs were confirmed for creation. */
  mutate: (createMissingDirs: boolean) => void;
  onError: (message: string) => void;
}

/**
 * Submit flow shared by the workspace dialogs: validate paths on the daemon,
 * and when some are missing, hold them in state so a confirmation dialog can
 * ask before re-submitting with `createMissingDirs`.
 */
export function useConfirmCreateDirs({ mutate, onError }: UseConfirmCreateDirsOptions) {
  const utils = trpc.useUtils();
  const [validating, setValidating] = useState(false);
  const [dirsToCreate, setDirsToCreate] = useState<string[] | null>(null);

  async function submit(paths: string[]) {
    if (paths.length === 0) {
      mutate(false);
      return;
    }

    setValidating(true);
    try {
      const { results } = await utils.file.validatePaths.fetch({ paths }, { staleTime: 0 });
      const missing = results.filter((r) => !r.exists).map((r) => r.path);
      if (missing.length > 0) {
        setDirsToCreate(missing);
        return;
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
      return;
    } finally {
      setValidating(false);
    }
    mutate(false);
  }

  function confirm() {
    setDirsToCreate(null);
    mutate(true);
  }

  function cancel() {
    setDirsToCreate(null);
  }

  function reset() {
    setValidating(false);
    setDirsToCreate(null);
  }

  return { submit, confirm, cancel, reset, validating, dirsToCreate };
}

interface ConfirmCreateDirsDialogProps {
  /** Directories to confirm; null keeps the dialog closed. */
  dirs: string[] | null;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmCreateDirsDialog({
  dirs,
  actionLabel,
  onConfirm,
  onCancel,
}: ConfirmCreateDirsDialogProps) {
  return (
    <AlertDialog
      open={dirs !== null}
      onOpenChange={(val) => {
        if (!val) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Create missing directories?</AlertDialogTitle>
          <AlertDialogDescription>
            The following directories don&apos;t exist and will be created:
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="flex flex-col gap-1">
          {(dirs ?? []).map((dir) => (
            <li key={dir} className="font-mono text-xs">
              {dir}
            </li>
          ))}
        </ul>
        <AlertDialogFooter>
          <AlertDialogCancel>Back</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{actionLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
