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
  const label = tab.oscTitle ?? scopeLabel;
  const isDir = tab.scope.scopeType === 'dir';
  const displayLabel = isDir && !tab.oscTitle ? collapseLabel(scopeLabel) : label;

  function commitRename(value: string, viaEnter: boolean) {
    const trimmed = value.trim();
    setIsEditing(false);
    if (!trimmed) return;
    // Pressing Enter on an unchanged OSC title still renames — it pins the
    // title so the program can no longer overwrite it. Blur with unchanged
    // text stays a no-op so an accidental double-click doesn't pin.
    if (trimmed !== editStartLabel || (viaEnter && tab.oscTitle)) {
      renameTerminal(tab.sessionId, trimmed);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.stopPropagation();
      commitRename(e.currentTarget.value, true);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setIsEditing(false);
    }
  }

  function handleBlur(e: React.FocusEvent<HTMLInputElement>) {
    commitRename(e.currentTarget.value, false);
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
    <span className="min-w-0 truncate" onDoubleClick={() => { setEditStartLabel(label); setIsEditing(true); }}>
      {displayLabel}
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
              <p className="font-mono">{label}</p>
              {tab.oscTitle && <p className="font-mono opacity-70">{scopeLabel}</p>}
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
