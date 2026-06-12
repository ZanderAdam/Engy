'use client';

import { useEffect, useState } from 'react';
import { RiTerminalLine, RiCloseLine } from '@remixicon/react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import { useIsMobile } from '@/hooks/use-mobile';
import { useTerminalDock } from './terminal-dock-context';
import { getTerminalIconStyle, type TerminalPanelParams, type TerminalTab } from './types';

function collapseLabel(label: string): string {
  const parts = label.split('/').filter(Boolean);
  if (parts.length <= 2) return label;
  return `/${parts[0]}/.../${parts[parts.length - 1]}`;
}

export function TerminalDockTab({ api, params }: IDockviewPanelHeaderProps<TerminalPanelParams>) {
  const [tab, setTab] = useState<TerminalTab>(params.tab);
  const [isEditing, setIsEditing] = useState(false);
  const [editStartLabel, setEditStartLabel] = useState('');
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);
  const { renameTerminal } = useTerminalDock();
  const isMobile = useIsMobile();

  useEffect(() => {
    const disposable = api.onDidParametersChange(() => {
      const updated = api.getParameters() as TerminalPanelParams;
      if (updated?.tab) setTab(updated.tab);
    });
    return () => disposable.dispose();
  }, [api]);

  const scopeLabel = tab.scope.scopeLabel;
  const label = scopeLabel;
  const isDir = tab.scope.scopeType === 'dir';
  const displayLabel = isDir ? collapseLabel(scopeLabel) : scopeLabel;

  function commitRename(value: string) {
    const trimmed = value.trim();
    setIsEditing(false);
    if (trimmed && trimmed !== editStartLabel) {
      renameTerminal(tab.sessionId, trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.stopPropagation();
      commitRename(e.currentTarget.value);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setIsEditing(false);
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    commitRename(e.currentTarget.value);
  }

  const editInput = (
    <input
      className="min-w-0 truncate bg-transparent outline-none text-xs font-mono"
      defaultValue={label}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      autoFocus
    />
  );

  const labelSpan = (
    <span
      className="flex min-w-0 flex-col justify-center gap-0.5"
      onDoubleClick={() => { setEditStartLabel(label); setIsEditing(true); }}
    >
      <span className="truncate leading-tight">{displayLabel}</span>
      {tab.oscTitle ? (
        <span className="truncate font-mono text-[9px] leading-none text-muted-foreground">
          {tab.oscTitle}
        </span>
      ) : (
        <span aria-hidden className="h-2.5" />
      )}
    </span>
  );

  return (
    <div
      className={cn(
        'group flex h-full max-w-[180px] items-center gap-1.5 px-2.5 text-xs',
        tab.status === 'exited' && 'opacity-50',
      )}
    >
      <RiTerminalLine className={cn('size-[11px] shrink-0', getTerminalIconStyle(tab))} />
      {isEditing ? (
        editInput
      ) : (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>{labelSpan}</TooltipTrigger>
            <TooltipContent side="bottom">
              <p className="font-mono">{scopeLabel}</p>
              {tab.oscTitle && <p className="font-mono opacity-70">{tab.oscTitle}</p>}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {tab.status === 'exited' && (
        <span className="shrink-0 text-[9px] text-muted-foreground">[exited]</span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          setConfirmCloseOpen(true);
        }}
        className={cn(
          'ml-auto shrink-0 rounded-sm p-0.5 hover:bg-muted',
          isMobile ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        )}
        aria-label="Close terminal"
      >
        <RiCloseLine className="size-[10px]" />
      </button>
      <AlertDialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Close terminal?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end the session for{' '}
              <span className="font-mono">{label}</span> and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              // Defer the panel removal so Radix finishes closing this dialog
              // (focus restore, body scroll/pointer-events unlock) before
              // api.close() unmounts the tab — and the dialog portal with it.
              onClick={() => queueMicrotask(() => api.close())}
            >
              Close terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
