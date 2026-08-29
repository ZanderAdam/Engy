'use client';

import { trpc } from '@/lib/trpc';
import type { GitPatchSpec } from '@engy/common';

interface FilePatchInputs {
  repoDir: string | null;
  filePath: string | null;
  /** Previous path of a rename, so `-M` pairs the two sides. */
  oldPath?: string;
  /** Which two snapshots to compare; null while the selection is incomplete. */
  spec: GitPatchSpec | null;
  /** Identity of the mutable content the patch reads (FR-GIT-310). */
  contentId?: string;
  /** Ref holding the original side. Absent for an added file, which has none. */
  originalRef?: string;
  originalId?: string;
  worktreePath?: string;
  coderWorkspace?: string;
  /** Callers gate on file kind — a binary or image path has no patch to show. */
  enabled?: boolean;
}

interface FilePatch {
  patch: string;
  /** Original side's full text, for context expansion and tokenization. */
  oldSource: string;
  truncated: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * The diff surface's single source of content. Git computes the hunks, so the
 * two sides can no longer disagree the way two independent content reads could.
 * The one remaining read is the original side, which `expandFromRawCode` and
 * `tokenize` both need and neither derives from the patch.
 */
export function useFilePatch({
  repoDir,
  filePath,
  oldPath,
  spec,
  contentId,
  originalRef,
  originalId,
  worktreePath,
  coderWorkspace,
  enabled = true,
}: FilePatchInputs): FilePatch {
  const canQuery = enabled && !!repoDir && !!filePath && !!spec;

  const {
    data: patchData,
    error: patchError,
    isFetching: isPatchFetching,
  } = trpc.diff.getPatch.useQuery(
    {
      repoDir: repoDir!,
      filePath: filePath!,
      oldPath,
      spec: spec!,
      contentId,
      worktreePath,
      coderWorkspace,
    },
    { enabled: canQuery, retry: false },
  );

  const { data: originalData } = trpc.file.read.useQuery(
    {
      repoDir: repoDir!,
      filePath: oldPath ?? filePath!,
      ref: originalRef,
      contentId: originalId,
      worktreePath,
      coderWorkspace,
    },
    { enabled: canQuery && !!originalRef, retry: false },
  );

  return {
    patch: patchData?.patch ?? '',
    // A failed expansion source only costs context lines, so its error is not
    // surfaced — the patch alone still renders every change.
    oldSource: originalRef ? (originalData?.content ?? '') : '',
    truncated: patchData?.truncated ?? false,
    isLoading: canQuery && isPatchFetching && patchData === undefined,
    error: patchError?.message ?? null,
  };
}
