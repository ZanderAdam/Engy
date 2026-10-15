'use client';

import type { ReactNode } from 'react';
import { RiArrowDownSLine, RiArrowRightSLine } from '@remixicon/react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { AttentionBadge } from './attention-badge';
import type { TerminalTab } from './types';

interface CollapsibleRailGroupProps {
  label: ReactNode;
  accessibleName: string;
  tabs: TerminalTab[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  headerClassName?: string;
  contentClassName?: string;
  /** Controls beside the toggle, outside it, so clicking them never folds the group. */
  actions?: ReactNode;
  children: ReactNode;
}

export function CollapsibleRailGroup({
  label,
  accessibleName,
  tabs,
  open,
  onOpenChange,
  headerClassName,
  contentClassName,
  actions,
  children,
}: CollapsibleRailGroupProps) {
  const Chevron = open ? RiArrowDownSLine : RiArrowRightSLine;
  const needsAttention = tabs.some((tab) => tab.needsAttention);
  const toggleLabel = open
    ? `Collapse ${accessibleName}`
    : `Expand ${accessibleName}, ${tabs.length} hidden${needsAttention ? ', needs attention' : ''}`;
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="flex flex-col gap-0.5">
      <div className="group/section flex items-center gap-1 pr-1">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            aria-label={toggleLabel}
            className={cn(
              'flex min-w-0 flex-1 items-center gap-1 rounded-sm px-1 text-left hover:bg-muted',
              headerClassName,
            )}
          >
            <Chevron className="size-3 shrink-0 text-muted-foreground" />
            {label}
            {!open && (
              <>
                <span className="shrink-0 text-[11px] font-normal tabular-nums text-muted-foreground">
                  {tabs.length}
                </span>
                <AttentionBadge needsAttention={needsAttention} />
              </>
            )}
          </button>
        </CollapsibleTrigger>
        {actions}
      </div>
      <CollapsibleContent className={contentClassName}>{children}</CollapsibleContent>
    </Collapsible>
  );
}
