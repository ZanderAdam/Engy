'use client';

import { useState } from 'react';
import { RiPlugLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

// Live set of dispatch-connected worker session ids. Components rerender on
// TERMINAL_WORKERS_CHANGE broadcasts (connect/disconnect from any browser).
function useDispatchWorkers() {
  const utils = trpc.useUtils();
  const { data } = trpc.terminal.listWorkers.useQuery();
  useOnServerEvent('TERMINAL_WORKERS_CHANGE', () => {
    void utils.terminal.listWorkers.invalidate();
  });
  return new Set((data ?? []).map((w) => w.sessionId));
}

// Toggle button for the terminal dock header: connects the ACTIVE terminal as
// a dispatch worker (with a user-supplied description other agents see in
// terminal_list_workers), or disconnects it when already connected.
export function TerminalWorkerButton({
  activeSessionId,
  defaultDescription,
}: {
  activeSessionId: string | undefined;
  defaultDescription?: string;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [description, setDescription] = useState('');
  const utils = trpc.useUtils();
  const workers = useDispatchWorkers();
  const connectMutation = trpc.terminal.connectWorker.useMutation({
    onSuccess: () => utils.terminal.listWorkers.invalidate(),
  });
  const disconnectMutation = trpc.terminal.disconnectWorker.useMutation({
    onSuccess: () => utils.terminal.listWorkers.invalidate(),
  });

  const isConnected = activeSessionId != null && workers.has(activeSessionId);

  function onToggle() {
    if (!activeSessionId) return;
    if (isConnected) {
      disconnectMutation.mutate({ sessionId: activeSessionId });
    } else {
      setDescription(defaultDescription ?? '');
      setDialogOpen(true);
    }
  }

  function onConnect() {
    if (!activeSessionId || !description.trim()) return;
    connectMutation.mutate(
      { sessionId: activeSessionId, description: description.trim() },
      { onSuccess: () => setDialogOpen(false) },
    );
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
          <button
            onClick={onToggle}
            disabled={!activeSessionId}
            aria-label={isConnected ? 'Disconnect dispatch worker' : 'Connect as dispatch worker'}
            className={cn(
              'flex h-8 w-8 items-center justify-center border-l border-border',
              isConnected
                ? 'text-emerald-400 hover:bg-muted'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              !activeSessionId && 'opacity-50',
            )}
          >
            <RiPlugLine className="size-3" />
          </button>
          </TooltipTrigger>
          <TooltipContent>
            {isConnected
              ? 'Connected as dispatch worker — click to disconnect'
              : 'Connect this terminal as a dispatch worker (other agents can send it prompts)'}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Connect as dispatch worker</DialogTitle>
            <DialogDescription>
              Other agent sessions will see this terminal in terminal_list_workers and can send it
              prompts. Describe what this terminal is working on.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='e.g. "codex on web frontend" or "claude fixing auth tests"'
            onKeyDown={(e) => {
              if (e.key === 'Enter') onConnect();
            }}
            autoFocus
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={onConnect} disabled={!description.trim() || connectMutation.isPending}>
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
