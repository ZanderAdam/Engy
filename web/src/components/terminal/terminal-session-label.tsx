'use client';

import { RiTerminalLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import {
  getTerminalIconStyle,
  getTerminalRailBoxStyle,
  isStoppedTerminal,
  type TerminalTab,
} from './types';
import { resolveTerminalLabel } from './terminal-label';
import { AttentionBadge } from './attention-badge';

interface TerminalSessionLabelProps {
  tab: TerminalTab;
  className?: string;
  // When set, render the icon as a filled activity-coloured box (matching the
  // collapsed rail dots) instead of just colouring the icon stroke.
  iconBox?: boolean;
}

// Shared icon + label + branch subtitle. Rendered by the "all terminals"
// dropdown and the terminal rail's hover so a session reads identically in
// both. The dock tab has a parallel implementation (its own tab chrome) that
// calls the same resolveTerminalLabel precedence helper rather than reusing
// this component directly. The icon colour/animation comes from
// getTerminalIconStyle (idle/active/waiting/done), keeping the activity cue
// consistent across surfaces. With iconBox the activity state colours the whole
// box (getTerminalRailBoxStyle), matching the collapsed rail's filled dots.
export function TerminalSessionLabel({ tab, className, iconBox }: TerminalSessionLabelProps) {
  const mainLabel = resolveTerminalLabel(tab.scope, tab.oscTitle);
  const branch = tab.scope.worktreeBranch;
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
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate leading-tight">{mainLabel}</span>
          <AttentionBadge needsAttention={tab.needsAttention} />
        </span>
        {branch && (
          <span className="truncate font-mono text-[9px] leading-none text-muted-foreground">
            {branch}
          </span>
        )}
      </span>
    </span>
  );
}
