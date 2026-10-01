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
  const refreshThreads = () => utils.comment.listThreadsByPrefix.invalidate();
  const { mutateAsync: createDraft } = trpc.review.createDraft.useMutation({
    onSuccess: refreshThreads,
  });
  const { mutateAsync: reply } = trpc.review.reply.useMutation({ onSuccess: refreshThreads });
  const { mutateAsync: resolveThread } = trpc.review.resolveThread.useMutation({
    onSuccess: (result, variables) => {
      if (result.localOnly) {
        toast.warning(
          variables.resolved
            ? 'No permission to resolve on GitHub. Resolved in Engy only.'
            : 'No permission to unresolve on GitHub. Reopened in Engy only.',
        );
      }
      return refreshThreads();
    },
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
      replyToThread: async (threadId, body) => {
        await reply({ workspaceId, repoFullName, prNumber, threadId, body });
      },
      setThreadResolved: async (threadId, resolved) => {
        await resolveThread({ workspaceId, repoFullName, prNumber, threadId, resolved });
      },
    }),
    [createDraft, reply, resolveThread, workspaceId, repoFullName, prNumber],
  );
}
