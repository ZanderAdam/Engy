'use client';

import { RiArrowLeftLine, RiExternalLinkLine, RiLoader4Line } from '@remixicon/react';
import { formatRelativeTime } from '@/components/prs/pr-helpers';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ReviewAvatar } from '@/components/review/review-avatar';
import { ReviewOverview } from '@/components/review/review-overview';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import type { GhPrCiStatus } from '@engy/common';
import { InboxCiBadge, InboxRiskBadge } from './inbox-badges';
import { EVENT_META, hasAvatar, summarizeEvent } from './inbox-event-meta';
import { githubAvatarUrl, type InboxItem } from './inbox-helpers';

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

function ActivityRow({ event }: { event: InboxItem['events'][number] }) {
  const { icon: Icon, className } = EVENT_META[event.kind];
  return (
    <li className="flex items-center gap-2 px-4 py-2">
      <Icon className={cn('size-4 shrink-0', className)} />
      {hasAvatar(event) && (
        <ReviewAvatar login={event.actor} avatarUrl={githubAvatarUrl(event.actor)} />
      )}
      <p className="min-w-0 flex-1 text-sm text-foreground">{summarizeEvent(event)}</p>
      <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(event.at)}</span>
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
  );
}

function PrOverview(props: { workspaceId: number; repoFullName: string; prNumber: number }) {
  const { data, error, isLoading } = trpc.review.detail.useQuery(props);
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
        <RiLoader4Line className="size-4 animate-spin" />
        Loading pull request...
      </div>
    );
  }
  if (error || !data) {
    return (
      <p className="px-4 py-3 text-xs text-destructive">
        {error?.message ?? 'Could not load the pull request'}
      </p>
    );
  }
  return <ReviewOverview detail={data} compact {...props} />;
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
          <InboxRiskBadge risk={item.risk} />
          <InboxCiBadge ci={ci} />
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
        {item.workspaceId === null && (
          <p className="text-xs text-muted-foreground">{NO_WORKSPACE_HINT}</p>
        )}
      </div>
      <section aria-label="Activity" className="flex flex-col border-b border-border">
        <h3 className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        <ul className="flex flex-col">
          {item.events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
          {item.events.length === 0 && (
            <li className="px-4 py-3 text-xs text-muted-foreground">No events yet</li>
          )}
        </ul>
      </section>
      {item.workspaceId !== null && (
        <PrOverview
          workspaceId={item.workspaceId}
          repoFullName={item.repoFullName}
          prNumber={item.prNumber}
        />
      )}
    </div>
  );
}
