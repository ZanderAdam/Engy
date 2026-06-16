'use client';

import { RiTerminalLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { getTerminalIconStyle, type TerminalTab } from './types';

interface TerminalSessionLabelProps {
  tab: TerminalTab;
  className?: string;
}

// Shared icon + scope label + OSC subtitle. Rendered by the dock tab, the
// "all terminals" dropdown, and the terminal rail's hover so a session reads
// identically wherever it appears. The icon colour/animation comes from
// getTerminalIconStyle (idle/active/waiting/done), keeping the activity cue
// consistent across surfaces.
export function TerminalSessionLabel({ tab, className }: TerminalSessionLabelProps) {
  return (
    <span
      className={cn(
        'flex min-w-0 items-start gap-1.5',
        tab.status === 'exited' && 'opacity-60',
        className,
      )}
    >
      <RiTerminalLine className={cn('mt-0.5 size-3 shrink-0', getTerminalIconStyle(tab))} />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate leading-tight">{tab.scope.scopeLabel}</span>
        {tab.oscTitle && (
          <span className="truncate font-mono text-[9px] leading-none text-muted-foreground">
            {tab.oscTitle}
          </span>
        )}
      </span>
    </span>
  );
}
