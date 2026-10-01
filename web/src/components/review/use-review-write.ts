'use client';

import { useMemo } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import type { ReviewWriteActions } from '@/components/diff/review-write-context';

interface ReviewTarget {
  workspaceId: number;
  repoFullName: string;
  prNumber: number;
}

export function useReviewWriteActions({
  workspaceId,
  repoFullName,
  prNumber,
}: ReviewTarget): ReviewWriteActions {
  const utils = trpc.useUtils();
  const { mutateAsync: createDraft } = trpc.review.createDraft.useMutation({
    onSuccess: () => utils.comment.listThreadsByPrefix.invalidate(),
  });

  return useMemo(
    () => ({
      addDraft: async (filePath, lineNumber, side, text, codeLine) => {
        try {
          await createDraft({
            workspaceId,
            repoFullName,
            prNumber,
            filePath,
            lineNumber,
            side,
            codeLine,
            text,
          });
        } catch (error) {
          toast.error(error instanceof Error ? error.message : 'Could not save the draft');
        }
      },
    }),
    [createDraft, workspaceId, repoFullName, prNumber],
  );
}
