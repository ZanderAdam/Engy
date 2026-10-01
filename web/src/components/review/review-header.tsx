'use client';

import type { ReactNode } from 'react';
import { RiDraftLine, RiExternalLinkLine, RiTerminalBoxLine } from '@remixicon/react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CiPill, ChecksPopover, ReviewDecisionBadge } from '@/components/prs/pr-badges';
import type { PrDetail } from '@/server/github/pr-detail';
import { ReviewAvatar } from './review-avatar';

interface ReviewHeaderProps {
  prNumber: number;
  detail: PrDetail;
  onOpenTerminal: () => void;
  agentReview: ReactNode;
  submitReview: ReactNode;
}

function StateBadge({ state }: { state: string }) {
  if (state === 'OPEN') return null;
  return (
    <Badge variant="outline" className="h-4 px-1.5 text-[10px] capitalize text-muted-foreground">
      {state.toLowerCase()}
    </Badge>
  );
}

export function ReviewHeader({
  prNumber,
  detail,
  onOpenTerminal,
  agentReview,
  submitReview,
}: ReviewHeaderProps) {
  return (
    <header className="flex flex-col gap-2 border-b border-border px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="min-w-0 text-base font-semibold text-foreground">{detail.title}</h1>
        <span className="font-mono text-sm text-muted-foreground">#{prNumber}</span>
        {detail.isDraft && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-muted-foreground">
            <RiDraftLine className="size-2.5" />
            Draft
          </Badge>
        )}
        <StateBadge state={detail.state} />
        {detail.mergeable === 'CONFLICTING' && (
          <Badge
            variant="outline"
            className="h-4 border-destructive/30 bg-destructive/10 px-1.5 text-[10px] text-destructive"
          >
            Conflicts
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        {detail.author && (
          <span className="flex items-center gap-1.5">
            <ReviewAvatar login={detail.author.login} avatarUrl={detail.author.avatarUrl} />
            {detail.author.login}
          </span>
        )}
        <span className="font-mono">
          {detail.baseRefName} ← {detail.headRefName}
        </span>
        <span className="flex items-center gap-2">
          <CiPill status={detail.ciStatus} />
          <ChecksPopover checks={detail.checks} />
        </span>
        <ReviewDecisionBadge decision={detail.reviewDecision} />
        {detail.reviewRequests.length > 0 && (
          <span className="flex items-center gap-1" aria-label="Requested reviewers">
            {detail.reviewRequests.map((reviewer) => (
              <ReviewAvatar
                key={reviewer.login}
                login={reviewer.login}
                avatarUrl={reviewer.avatarUrl}
              />
            ))}
          </span>
        )}
        <span className="font-mono">
          <span className="text-green-500">+{detail.additions}</span>{' '}
          <span className="text-red-500">−{detail.deletions}</span>
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <Button variant="outline" size="xs" asChild>
            <a href={detail.url} target="_blank" rel="noopener noreferrer">
              <RiExternalLinkLine className="size-3" />
              Open on GitHub
            </a>
          </Button>
          <Button variant="outline" size="xs" onClick={onOpenTerminal}>
            <RiTerminalBoxLine className="size-3" />
            Open terminal here
          </Button>
          {agentReview}
          {submitReview}
        </span>
      </div>
    </header>
  );
}
