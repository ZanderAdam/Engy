'use client';

import {
  RiArrowLeftLine,
  RiCheckLine,
  RiChat1Line,
  RiExternalLinkLine,
  RiLoader4Line,
  RiTerminalLine,
  RiZzzLine,
} from '@remixicon/react';
import { formatRelativeTime } from '@/components/prs/pr-helpers';
import { AttentionBadge, ChecksPopover, ReviewDecisionBadge } from '@/components/prs/pr-badges';
import { KeptBadge } from '@/components/prs/kept-badge';
import type { KeptReview } from '@/components/prs/use-kept-reviews';
import { VLink } from '@/components/tabs/virtual-link';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ReviewAvatar } from '@/components/review/review-avatar';
import { ReviewOverview } from '@/components/review/review-overview';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { InboxCiBadge, InboxRiskBadge } from './inbox-badges';
import { EVENT_META, hasAvatar, summarizeEvent } from './inbox-event-meta';
import { githubAvatarUrl, type InboxItem } from './inbox-helpers';
import type { InboxRowModel } from './inbox-rows';

interface InboxPreviewProps {
  row: InboxRowModel;
  canReview: boolean;
  onOpenReview: () => void;
  onBack: (() => void) | null;
  diffsHref: string | null;
  kept: KeptReview | undefined;
  onRemoveKept: (worktreeId: number, force: boolean) => void;
  onDone: () => void;
  onSnooze: () => void;
  onToggleRead: () => void;
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

function PrStatusStrip({
  pr,
  diffsHref,
  kept,
  onRemoveKept,
}: Pick<InboxPreviewProps, 'diffsHref' | 'kept' | 'onRemoveKept'> & {
  pr: NonNullable<InboxRowModel['pr']>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {pr.isDraft && <span className="text-xs text-muted-foreground">Draft</span>}
      <ReviewDecisionBadge decision={pr.reviewDecision} />
      <ChecksPopover checks={pr.checks} />
      {pr.commentCount > 0 && (
        <a
          href={pr.url}
          target="_blank"
          rel="noopener noreferrer"
          title="Conversation and reviews"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RiChat1Line className="size-3" />
          {pr.commentCount}
        </a>
      )}
      {pr.worktreePath && diffsHref && (
        <VLink
          href={diffsHref}
          title={`Worktree at ${pr.worktreePath}`}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <RiTerminalLine className="size-3" />
          View diffs
        </VLink>
      )}
      <AttentionBadge reason={pr.attentionReason} />
      {kept && <KeptBadge kept={kept} onRemove={onRemoveKept} />}
    </div>
  );
}

export function InboxPreview({
  row,
  canReview,
  onOpenReview,
  onBack,
  diffsHref,
  kept,
  onRemoveKept,
  onDone,
  onSnooze,
  onToggleRead,
}: InboxPreviewProps) {
  const events = row.item?.events ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-2 border-b border-border px-4 py-3">
        {onBack && (
          <Button variant="ghost" size="sm" className="-ml-2 w-fit" onClick={onBack}>
            <RiArrowLeftLine className="size-4" />
            Back
          </Button>
        )}
        <h2 className="text-base font-semibold text-foreground">{row.title}</h2>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-mono">
            {row.repoFullName}#{row.prNumber}
          </span>
          <InboxRiskBadge risk={row.risk} />
          <InboxCiBadge ci={row.ci} />
        </div>
        {row.pr && (
          <TooltipProvider>
            <PrStatusStrip
              pr={row.pr}
              diffsHref={diffsHref}
              kept={kept}
              onRemoveKept={onRemoveKept}
            />
          </TooltipProvider>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <OpenReviewButton canReview={canReview} onOpenReview={onOpenReview} />
          <Button variant="outline" size="sm" asChild>
            <a href={row.url} target="_blank" rel="noopener noreferrer">
              <RiExternalLinkLine className="size-4" />
              Open on GitHub
            </a>
          </Button>
          {row.item && (
            <>
              <Button variant="outline" size="sm" onClick={onDone}>
                <RiCheckLine className="size-4" />
                Done
              </Button>
              <Button variant="outline" size="sm" onClick={onSnooze}>
                <RiZzzLine className="size-4" />
                Snooze
              </Button>
              <Button variant="outline" size="sm" onClick={onToggleRead}>
                {row.item.unread ? 'Mark read' : 'Mark unread'}
              </Button>
            </>
          )}
        </div>
        {row.workspaceId === null && (
          <p className="text-xs text-muted-foreground">{NO_WORKSPACE_HINT}</p>
        )}
      </div>
      <section aria-label="Activity" className="flex flex-col border-b border-border">
        <h3 className="px-4 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Activity
        </h3>
        <ul className="flex flex-col">
          {events.map((event) => (
            <ActivityRow key={event.id} event={event} />
          ))}
          {events.length === 0 && (
            <li className="px-4 py-3 text-xs text-muted-foreground">No events yet</li>
          )}
        </ul>
      </section>
      {row.workspaceId !== null && (
        <PrOverview
          workspaceId={row.workspaceId}
          repoFullName={row.repoFullName}
          prNumber={row.prNumber}
        />
      )}
    </div>
  );
}
