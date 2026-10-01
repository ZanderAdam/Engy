'use client';

import { useState } from 'react';
import { RiMore2Line } from '@remixicon/react';
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
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface InboxMoreMenuProps {
  totalCount: number;
  readCount: number;
  onMarkAllRead: () => void;
  onClear: (onlyRead: boolean) => void;
}

export function InboxMoreMenu({
  totalCount,
  readCount,
  onMarkAllRead,
  onClear,
}: InboxMoreMenuProps) {
  const [pendingClear, setPendingClear] = useState<'read' | 'all' | null>(null);
  const clearCount = pendingClear === 'read' ? readCount : totalCount;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="More inbox actions">
            <RiMore2Line className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={onMarkAllRead}>Mark all as read</DropdownMenuItem>
          <DropdownMenuItem disabled={readCount === 0} onSelect={() => setPendingClear('read')}>
            Clear all read
          </DropdownMenuItem>
          <DropdownMenuItem disabled={totalCount === 0} onSelect={() => setPendingClear('all')}>
            Clear all
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AlertDialog
        open={pendingClear !== null}
        onOpenChange={(open) => {
          if (!open) setPendingClear(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Clear {clearCount} {clearCount === 1 ? 'item' : 'items'}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They leave the inbox and are marked done on GitHub.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => onClear(pendingClear === 'read')}>
              Clear
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
