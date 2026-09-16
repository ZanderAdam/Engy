'use client';

import { RiTerminalLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { useTerminalNumber } from './use-terminal-number';
import {
  getTerminalIconStyle,
  getTerminalRailBoxStyle,
  isStoppedTerminal,
  type TerminalTab,
} from './types';

interface TerminalSessionLabelProps {
  tab: TerminalTab;
  className?: string;
  // When set, render the icon as a filled activity-coloured box (matching the
  // collapsed rail dots) instead of just colouring the icon stroke.
  iconBox?: boolean;
}

// Shared icon + scope label + OSC subtitle. Rendered by the dock tab, the
// "all terminals" dropdown, and the terminal rail's hover so a session reads
// identically wherever it appears. The icon colour/animation comes from
// getTerminalIconStyle (idle/active/waiting/done), keeping the activity cue
// consistent across surfaces. With iconBox the activity state colours the whole
// box (getTerminalRailBoxStyle), matching the collapsed rail's filled dots.
//
// The terminal number lives here rather than at each call site so it reaches
// every surface that names a terminal at once — it went missing from the
// expanded rail when only the collapsed dot rendered it.
export function TerminalSessionLabel({ tab, className, iconBox }: TerminalSessionLabelProps) {
  const terminalNumber = useTerminalNumber(tab.sessionId);
  return (
    <span
      className={cn(
        'flex min-w-0 items-start gap-1.5',
        isStoppedTerminal(tab.status) && 'opacity-60',
        className,
      )}
    >
      {iconBox ? (
        <span
          className={cn(
            'flex size-4 shrink-0 items-center justify-center rounded-[4px]',
            getTerminalRailBoxStyle(tab),
          )}
        >
          <RiTerminalLine className="size-2.5" />
        </span>
      ) : (
        <RiTerminalLine className={cn('mt-0.5 size-3 shrink-0', getTerminalIconStyle(tab))} />
      )}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate leading-tight">
          {terminalNumber !== null && (
            <span className="mr-1 rounded-[3px] bg-foreground/15 px-1 text-[10px] tabular-nums text-foreground/80">
              {terminalNumber}
            </span>
          )}
          {tab.scope.scopeLabel}
        </span>
        {tab.oscTitle && (
          <span className="truncate font-mono text-[9px] leading-none text-muted-foreground">
            {tab.oscTitle}
          </span>
        )}
      </span>
    </span>
  );
}
