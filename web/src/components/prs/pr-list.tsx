'use client';

import {
  RiExternalLinkLine,
  RiGitBranchLine,
  RiUser3Line,
  RiDraftLine,
  RiTerminalLine,
  RiAlarmWarningLine,
  RiChat1Line,
} from '@remixicon/react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { VLink } from '@/components/tabs/virtual-link';
import { buildReviewPath } from '@/lib/review-path';
import { formatRelativeTime } from './pr-helpers';
import { CiPill, ChecksPopover, ReviewDecisionBadge } from './pr-badges';
import { getAttentionInfo } from '@/lib/pr-attention';
import { prKey } from '@/components/inbox/inbox-helpers';
import { KeptBadge } from './kept-badge';
import type { KeptReview } from './use-kept-reviews';
import type { GhPrCheck, GhPrCiStatus } from '@engy/common';

interface PrItem {
  id: number;
  repo: string;
  number: number;
  title: string;
  url: string;
  headBranch: string;
  author: string;
  isDraft: boolean;
  ciStatus: GhPrCiStatus;
  checks: GhPrCheck[];
  commentCount: number;
  reviewDecision: string | null;
  updatedAt: string;
  sessionId: string | null;
  taskGroupId: number | null;
  worktreePath: string | null;
  attentionReason: string | null;
  repoFullName: string | null;
}

interface PrListProps {
  prs: PrItem[];
  showRepo: boolean;
  workspaceSlug: string;
  projectSlug: string;
  unreadItemIds: ReadonlyMap<string, number>;
  keptByPr: ReadonlyMap<string, KeptReview>;
  onOpen: (inboxItemId: number) => void;
  onRemoveKept: (worktreeId: number, force: boolean) => void;
}

function AttentionBadge({ reason }: { reason: string | null }) {
  const attention = getAttentionInfo(reason);
  if (!attention) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 rounded-none border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 text-[10px] font-medium text-red-400 cursor-default">
          <RiAlarmWarningLine className="size-3 shrink-0" />
          {attention.label}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{attention.description}</TooltipContent>
    </Tooltip>
  );
}

export function PrList({
  prs,
  showRepo,
  workspaceSlug,
  projectSlug,
  unreadItemIds,
  keptByPr,
  onOpen,
  onRemoveKept,
}: PrListProps) {
  return (
    <TooltipProvider>
      <div className="divide-y divide-border">
        {prs.map((pr) => (
          <PrRow
            key={pr.id}
            pr={pr}
            showRepo={showRepo}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            unreadItemId={unreadItemIds.get(prKey(pr.repoFullName, pr.number))}
            kept={keptByPr.get(prKey(pr.repoFullName, pr.number))}
            onOpen={onOpen}
            onRemoveKept={onRemoveKept}
          />
        ))}
      </div>
    </TooltipProvider>
  );
}

interface PrRowProps {
  pr: PrItem;
  showRepo: boolean;
  workspaceSlug: string;
  projectSlug: string;
  unreadItemId: number | undefined;
  kept: KeptReview | undefined;
  onOpen: (inboxItemId: number) => void;
  onRemoveKept: (worktreeId: number, force: boolean) => void;
}

function PrRow({
  pr,
  showRepo,
  workspaceSlug,
  projectSlug,
  unreadItemId,
  kept,
  onOpen,
  onRemoveKept,
}: PrRowProps) {
  const reviewHref = pr.repoFullName
    ? buildReviewPath(workspaceSlug, pr.repoFullName, pr.number, projectSlug)
    : null;
  const diffsHref = `/w/${workspaceSlug}/projects/${projectSlug}/diffs`;
  const handleOpen = () => {
    if (unreadItemId !== undefined) onOpen(unreadItemId);
  };

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30 transition-colors">
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
          {unreadItemId !== undefined && (
            <span
              aria-label="Unread inbox item"
              className="size-2 shrink-0 rounded-full bg-sky-400"
            />
          )}
          {reviewHref ? (
            <VLink
              href={reviewHref}
              onClick={handleOpen}
              className="min-w-0 text-sm font-medium text-foreground hover:underline"
            >
              <span className="block truncate">{pr.title}</span>
            </VLink>
          ) : (
            <span className="min-w-0 truncate text-sm font-medium text-foreground">{pr.title}</span>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open on GitHub"
                onClick={handleOpen}
                className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiExternalLinkLine className="size-3" />
              </a>
            </TooltipTrigger>
            <TooltipContent>Open on GitHub</TooltipContent>
          </Tooltip>
          {pr.isDraft && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
              <RiDraftLine className="size-2.5" />
              Draft
            </Badge>
          )}
        </div>
        {pr.commentCount > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={pr.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleOpen}
                className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiChat1Line className="size-3" />
                {pr.commentCount}
              </a>
            </TooltipTrigger>
            <TooltipContent>
              {pr.commentCount === 1 ? '1 comment' : `${pr.commentCount} comments`} — conversation
              and reviews
            </TooltipContent>
          </Tooltip>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatRelativeTime(pr.updatedAt)}
        </span>
      </div>

      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {showRepo && (
          <span className="font-mono text-foreground/70 truncate max-w-[160px]">
            {pr.repo.split('/').pop()}
          </span>
        )}
        <span className="font-mono">#{pr.number}</span>
        <span className="flex items-center gap-1">
          <RiUser3Line className="size-3" />
          {pr.author}
        </span>
        <span className="flex items-center gap-1 truncate max-w-[200px]">
          <RiGitBranchLine className="size-3 shrink-0" />
          <span className="truncate font-mono">{pr.headBranch}</span>
        </span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <CiPill status={pr.ciStatus} />

        <ReviewDecisionBadge decision={pr.reviewDecision} />

        <ChecksPopover checks={pr.checks} />

        {pr.worktreePath && (
          <Tooltip>
            <TooltipTrigger asChild>
              <VLink
                href={diffsHref}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <RiTerminalLine className="size-3" />
                <span>View diffs</span>
              </VLink>
            </TooltipTrigger>
            <TooltipContent>Open in Diffs tab — worktree at {pr.worktreePath}</TooltipContent>
          </Tooltip>
        )}

        <AttentionBadge reason={pr.attentionReason} />

        {kept && <KeptBadge kept={kept} onRemove={onRemoveKept} />}
      </div>
    </div>
  );
}
