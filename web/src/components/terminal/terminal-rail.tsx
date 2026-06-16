'use client';

import { RiAddLine, RiTerminalLine } from '@remixicon/react';
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
import { getTerminalIconStyle } from './types';

// Persistent far-right rail showing one dot per terminal in the current scope.
// It lives outside the collapsible dock so it stays visible when the terminal
// panel is collapsed; the right-dock TerminalManager (always mounted) publishes
// its live tabs to the session store, so the dots' activity stays current.
// Clicking a dot focuses that terminal and auto-expands the dock (terminal:focus
// → broadcastActive → the layout uncollapses); hover shows the same label as the
// dock tab.
export function TerminalRail() {
  const scope = useTerminalScope();
  const tabId = useTabId();
  const { tabs, activeId } = useTerminalSessions(terminalRailKey(tabId, scope.groupKey));

  function focusSession(sessionId: string) {
    window.dispatchEvent(new CustomEvent('terminal:focus', { detail: { sessionId, tabId } }));
  }

  function openNew() {
    window.dispatchEvent(new CustomEvent('terminal:open', { detail: { scope, tabId } }));
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex w-10 shrink-0 flex-col items-center gap-1 border-l border-border bg-background py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={openNew}
              aria-label="New terminal"
              className="flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <RiAddLine className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">New terminal</TooltipContent>
        </Tooltip>

        {tabs.map((tab) => (
          <Tooltip key={tab.sessionId}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => focusSession(tab.sessionId)}
                aria-label={`Focus terminal ${tab.scope.scopeLabel}${tab.oscTitle ? `: ${tab.oscTitle}` : ''}`}
                aria-current={tab.sessionId === activeId || undefined}
                className={cn(
                  'flex size-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted',
                  tab.sessionId === activeId && 'bg-muted ring-1 ring-inset ring-border',
                  tab.status === 'exited' && 'opacity-40',
                )}
              >
                <RiTerminalLine className={cn('size-3.5', getTerminalIconStyle(tab))} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-72">
              <TerminalSessionLabel tab={tab} />
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
