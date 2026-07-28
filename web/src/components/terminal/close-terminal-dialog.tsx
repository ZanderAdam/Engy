'use client';

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

interface CloseTerminalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Scope label of the session being closed, shown in the confirmation copy.
  label: string;
  onConfirm: () => void;
}

// Shared confirmation for the three surfaces that can end a terminal session:
// the dock tab, the desktop rail's expanded list, and the mobile terminal list.
// Each closes the panel its own way (api.close(), a terminal:close event, or a
// panel lookup) but they all converge on the same removal → session kill, so
// the prompt and the deferral below are owned here.
export function CloseTerminalDialog({
  open,
  onOpenChange,
  label,
  onConfirm,
}: CloseTerminalDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close terminal?</AlertDialogTitle>
          <AlertDialogDescription>
            This will end the session for <span className="font-mono">{label}</span> and cannot be
            undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            // Closing a panel is synchronous and can unmount this dialog's own
            // host (the dock tab). Defer it so Radix finishes its close first —
            // focus restore, body pointer-events unlock — instead of tearing
            // down mid-teardown.
            onClick={() => queueMicrotask(onConfirm)}
          >
            Close terminal
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
