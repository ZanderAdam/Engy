'use client';

import { useState } from 'react';
import { RiDeleteBinLine } from '@remixicon/react';
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
import { KEPT_LABELS, type KeptReview } from './use-kept-reviews';

interface KeptBadgeProps {
  kept: KeptReview;
  onRemove: (worktreeId: number, force: boolean) => void;
}

export function KeptBadge({ kept, onRemove }: KeptBadgeProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const hasLocalChanges = kept.reason === 'local_changes';

  function handleRemoveClick() {
    if (hasLocalChanges) {
      setConfirmOpen(true);
      return;
    }
    onRemove(kept.id, false);
  }

  return (
    <span className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
      {KEPT_LABELS[kept.reason]}
      <button
        type="button"
        aria-label="Remove review worktree"
        onClick={handleRemoveClick}
        className="cursor-pointer hover:text-foreground transition-colors"
      >
        <RiDeleteBinLine className="size-3" />
      </button>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove worktree with local changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This review worktree has uncommitted changes. Removing it discards them for good.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => onRemove(kept.id, true)}
            >
              Remove and discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </span>
  );
}
