'use client';

import { RiAlertLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';

interface ReviewWorktreeBannerProps {
  stale: boolean;
  dirty: boolean;
  isUpdating: boolean;
  onUpdate: (discard: boolean) => void;
  onKeep: () => void;
}

export function ReviewWorktreeBanner({
  stale,
  dirty,
  isUpdating,
  onUpdate,
  onKeep,
}: ReviewWorktreeBannerProps) {
  if (!stale) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-amber-400/20 bg-amber-400/5 px-4 py-2 text-xs"
    >
      <RiAlertLine className="size-3.5 shrink-0 text-amber-400" />
      <span className="font-medium text-foreground">
        {dirty ? 'This worktree has local changes' : 'New commits on GitHub'}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {dirty ? (
          <>
            <Button size="xs" disabled={isUpdating} onClick={() => onUpdate(true)}>
              Discard and update
            </Button>
            <Button variant="outline" size="xs" disabled={isUpdating} onClick={onKeep}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="xs" disabled={isUpdating} onClick={() => onUpdate(false)}>
            {isUpdating ? 'Updating…' : 'Update'}
          </Button>
        )}
      </span>
    </div>
  );
}
