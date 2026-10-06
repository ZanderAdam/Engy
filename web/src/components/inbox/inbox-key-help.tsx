'use client';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { INBOX_KEY_HINTS } from './use-inbox-keys';

interface InboxKeyHelpProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function InboxKeyHelp({ open, onOpenChange }: InboxKeyHelpProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Inbox keys</DialogTitle>
          <DialogDescription>Keys work while no text field has focus.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-1.5">
          {INBOX_KEY_HINTS.map((hint) => (
            <li key={hint.keys} className="flex items-center justify-between gap-4 text-sm">
              <span>{hint.label}</span>
              <Kbd>{hint.keys}</Kbd>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
