'use client';

import { useState } from 'react';
import {
  RiAddLine,
  RiArrowLeftSLine,
  RiArrowRightSLine,
  RiListUnordered,
  RiTerminalLine,
} from '@remixicon/react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTabId } from '@/components/tabs/tab-context';
import { useTerminalScope } from './use-terminal-scope';
import { useTerminalSessions, terminalRailKey } from './terminal-session-store';
import { TerminalSessionLabel } from './terminal-session-label';
import { getTerminalRailBoxStyle } from './types';

interface TerminalRailProps {
  // Collapse state of the terminal dock (owned by ThreePanelLayout). The rail
  // hosts the collapse control so the dock's controls + the rail share one
  // column.
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
}

// Persistent rail of terminal status dots, immediately left of the terminal
// dock (so it lands at the screen edge when the dock collapses to zero width).
// Each dot is a filled box coloured by activity (idle/active/waiting/done);
// clicking it dispatches terminal:focus, which focuses the session and
// auto-expands the dock. The list toggle widens the rail into a labelled list
// that stays open until toggled (it does not close on outside clicks and
// survives dock collapse). A "+" opens a new terminal.
export function TerminalRail({ collapsed, setCollapsed }: TerminalRailProps) {
  const scope = useTerminalScope();
  const tabId = useTabId();
  const { tabs, activeId } = useTerminalSessions(terminalRailKey(tabId, scope.groupKey));
  const [listExpanded, setListExpanded] = useState(false);

  function focusSession(sessionId: string) {
    window.dispatchEvent(new CustomEvent('terminal:focus', { detail: { sessionId, tabId } }));
  }

  function openNew() {
    window.dispatchEvent(new CustomEvent('terminal:open', { detail: { scope, tabId } }));
  }

  const ctrlButton =
    'flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground';

  return (
    <TooltipProvider delayDuration={300}>
      <div
        className={cn(
          'flex shrink-0 flex-col gap-1.5 border-l border-border bg-background py-1.5 transition-[width] duration-200 ease-in-out',
          listExpanded ? 'w-60' : 'w-10 items-center',
        )}
      >
        {/* Controls — vertical icons when narrow, a header row when expanded. */}
        <div className={cn('flex gap-1', listExpanded ? 'flex-row items-center px-1' : 'flex-col items-center')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setCollapsed(!collapsed)}
                aria-label={collapsed ? 'Show terminal panel' : 'Collapse terminal panel'}
                className={ctrlButton}
              >
                {collapsed ? (
                  <RiArrowLeftSLine className="size-4" />
                ) : (
                  <RiArrowRightSLine className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">{collapsed ? 'Show panel' : 'Collapse panel'}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={openNew} aria-label="New terminal" className={ctrlButton}>
                <RiAddLine className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">New terminal</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setListExpanded((v) => !v)}
                aria-label={listExpanded ? 'Collapse terminal list' : 'Expand terminal list'}
                aria-expanded={listExpanded}
                className={cn(ctrlButton, listExpanded && 'bg-muted text-foreground')}
              >
                <RiListUnordered className="size-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Terminal list</TooltipContent>
          </Tooltip>
        </div>

        {/* Sessions — colour-coded dots when narrow, labelled rows when expanded. */}
        {listExpanded ? (
          <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
            {tabs.length === 0 ? (
              <p className="px-2 py-1.5 text-[11px] text-muted-foreground">No terminals</p>
            ) : (
              tabs.map((tab) => (
                <button
                  key={tab.sessionId}
                  type="button"
                  onClick={() => focusSession(tab.sessionId)}
                  aria-current={tab.sessionId === activeId || undefined}
                  className={cn(
                    'flex items-start rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted',
                    tab.sessionId === activeId && 'bg-muted',
                  )}
                >
                  <TerminalSessionLabel tab={tab} />
                </button>
              ))
            )}
          </div>
        ) : (
          tabs.map((tab) => (
            <Tooltip key={tab.sessionId}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => focusSession(tab.sessionId)}
                  aria-label={`Focus terminal ${tab.scope.scopeLabel}${tab.oscTitle ? `: ${tab.oscTitle}` : ''}`}
                  aria-current={tab.sessionId === activeId || undefined}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-[5px] transition-colors',
                    getTerminalRailBoxStyle(tab),
                    tab.sessionId === activeId && 'ring-1 ring-inset ring-foreground/60',
                  )}
                >
                  <RiTerminalLine className="size-3" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-72">
                <TerminalSessionLabel tab={tab} />
              </TooltipContent>
            </Tooltip>
          ))
        )}
      </div>
    </TooltipProvider>
  );
}
