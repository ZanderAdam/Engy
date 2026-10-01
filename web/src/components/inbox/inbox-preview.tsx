'use client';

import { RiArrowLeftLine, RiExternalLinkLine } from '@remixicon/react';
import { ciStatusClassName, ciStatusLabel, formatRelativeTime } from '@/components/prs/pr-helpers';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { GhPrCiStatus } from '@engy/common';
import { summarizeLatestEvent, type InboxItem } from './inbox-helpers';

interface InboxPreviewProps {
  item: InboxItem;
  ci: GhPrCiStatus | undefined;
  canReview: boolean;
  onOpenReview: () => void;
  onBack: (() => void) | null;
}

const NO_WORKSPACE_HINT = 'Add this repo to a workspace to review it in Engy';

function OpenReviewButton({
  canReview,
  onOpenReview,
}: Pick<InboxPreviewProps, 'canReview' | 'onOpenReview'>) {
  if (canReview) {
    return (
      <Button size="sm" onClick={onOpenReview}>
        Open review
      </Button>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button size="sm" disabled className="pointer-events-none">
              Open review
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{NO_WORKSPACE_HINT}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function InboxPreview({ item, ci, canReview, onOpenReview, onBack }: InboxPreviewProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        {onBack && (
          <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack}>
            <RiArrowLeftLine className="size-4" />
            Inbox
          </Button>
        )}
        <h2 className="text-base font-semibold text-foreground">{item.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            {item.repoFullName}#{item.prNumber}
          </span>
          {ci && (
            <span
              className={cn('border px-1.5 py-px text-[10px] font-medium', ciStatusClassName(ci))}
            >
              CI {ciStatusLabel(ci).toLowerCase()}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <OpenReviewButton canReview={canReview} onOpenReview={onOpenReview} />
          <Button variant="outline" size="sm" asChild>
            <a href={item.url} target="_blank" rel="noopener noreferrer">
              <RiExternalLinkLine className="size-4" />
              Open on GitHub
            </a>
          </Button>
        </div>
      </div>
      <ul className="flex flex-col">
        {item.events.map((event) => (
          <li key={event.id} className="flex items-start gap-3 border-b border-border px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">{summarizeLatestEvent(event)}</p>
              {event.actor && event.summary !== summarizeLatestEvent(event) && (
                <p className="text-xs text-muted-foreground">{event.summary}</p>
              )}
            </div>
            <span className="shrink-0 text-xs text-muted-foreground">
              {formatRelativeTime(event.at)}
            </span>
            {event.url && (
              <a
                href={event.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open event on GitHub"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <RiExternalLinkLine className="size-3.5" />
              </a>
            )}
          </li>
        ))}
        {item.events.length === 0 && (
          <li className="px-4 py-3 text-xs text-muted-foreground">No events yet</li>
        )}
      </ul>
    </div>
  );
}
