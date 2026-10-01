'use client';

import {
  RiExternalLinkLine,
  RiCheckLine,
  RiCloseLine,
  RiLoader4Line,
  RiTimeLine,
  RiQuestionLine,
  RiAlarmWarningLine,
} from '@remixicon/react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import { getAttentionInfo } from '@/lib/pr-attention';
import {
  ciStatusClassName,
  ciStatusLabel,
  reviewDecisionLabel,
  summarizeChecks,
  deriveCheckState,
} from './pr-helpers';
import type { GhPrCheck, GhPrCiStatus } from '@engy/common';

export function CheckIcon({ status, conclusion }: { status: string; conclusion: string | null }) {
  const state = deriveCheckState(status, conclusion);
  if (state === 'passing') return <RiCheckLine className="size-3 text-green-400 shrink-0" />;
  if (state === 'failing') return <RiCloseLine className="size-3 text-red-400 shrink-0" />;
  return <RiLoader4Line className="size-3 text-amber-400 shrink-0 animate-spin" />;
}

export function ChecksPopover({ checks }: { checks: GhPrCheck[] }) {
  const summary = summarizeChecks(checks);

  const triggerLabel =
    summary.total === 0 ? 'No checks' : `${summary.passing}/${summary.total} passed`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          {triggerLabel}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <div className="divide-y divide-border">
          {checks.map((check, i) => (
            <div key={`${check.name}-${i}`} className="flex items-start gap-2 px-3 py-2">
              <CheckIcon status={check.status} conclusion={check.conclusion} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-foreground truncate">{check.name}</p>
                {check.conclusion && (
                  <p className="text-xs text-muted-foreground capitalize">
                    {check.conclusion.replace(/_/g, ' ').toLowerCase()}
                  </p>
                )}
              </div>
              {check.detailsUrl && (
                <a
                  href={check.detailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <RiExternalLinkLine className="size-3 shrink-0" />
                </a>
              )}
            </div>
          ))}
          {checks.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No checks reported</div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function ReviewDecisionBadge({ decision }: { decision: string | null }) {
  const label = reviewDecisionLabel(decision);
  if (!label) return null;

  const isApproved = decision === 'APPROVED';
  const isChangesRequested = decision === 'CHANGES_REQUESTED';

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px] h-4 px-1.5 border',
        isApproved && 'text-green-400 border-green-400/30 bg-green-400/10',
        isChangesRequested && 'text-red-400 border-red-400/30 bg-red-400/10',
        !isApproved && !isChangesRequested && 'text-muted-foreground',
      )}
    >
      {label}
    </Badge>
  );
}

export function AttentionBadge({
  reason,
  compact = false,
}: {
  reason: string | null;
  compact?: boolean;
}) {
  const attention = getAttentionInfo(reason);
  if (!attention) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={attention.label}
          className="inline-flex shrink-0 cursor-default items-center gap-1 rounded-none border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400"
        >
          <RiAlarmWarningLine className="size-3 shrink-0" />
          {!compact && attention.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{attention.description}</TooltipContent>
    </Tooltip>
  );
}

export function CiPill({ status }: { status: GhPrCiStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-none border px-1.5 py-0.5 text-[10px] font-medium',
        ciStatusClassName(status),
      )}
    >
      <CiStatusIcon status={status} />
      {ciStatusLabel(status)}
    </span>
  );
}

function CiStatusIcon({ status }: { status: GhPrCiStatus }) {
  switch (status) {
    case 'passing':
      return <RiCheckLine className="size-3" />;
    case 'failing':
      return <RiCloseLine className="size-3" />;
    case 'pending':
      return <RiTimeLine className="size-3" />;
    case 'unknown':
      return <RiQuestionLine className="size-3" />;
  }
}
