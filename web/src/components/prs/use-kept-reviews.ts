import { useMemo } from 'react';
import { toast } from 'sonner';
import { trpc } from '@/lib/trpc';
import { prKey } from '@/components/inbox/inbox-helpers';

export type KeptReason = 'local_changes' | 'session_open';

export interface KeptReview {
  id: number;
  reason: KeptReason;
}

export const KEPT_LABELS: Record<KeptReason, string> = {
  local_changes: 'kept: local changes',
  session_open: 'kept: session open',
};

export function useKeptReviews(workspaceId: number, enabled: boolean) {
  const utils = trpc.useUtils();
  const { data: worktrees } = trpc.review.list.useQuery({ workspaceId }, { enabled });

  const { mutate: removeKept } = trpc.review.remove.useMutation({
    onSuccess: () => utils.review.list.invalidate({ workspaceId }),
    onError: (err) => toast.error(err.message),
  });

  const keptByPr = useMemo(() => {
    const kept = new Map<string, KeptReview>();
    for (const worktree of worktrees ?? []) {
      if (worktree.kept) {
        kept.set(prKey(worktree.repoFullName, worktree.prNumber), {
          id: worktree.id,
          reason: worktree.kept,
        });
      }
    }
    return kept;
  }, [worktrees]);

  return { keptByPr, removeKept };
}
