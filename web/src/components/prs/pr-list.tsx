'use client';

import {
  RiExternalLinkLine,
  RiGitBranchLine,
  RiUser3Line,
  RiDraftLine,
  RiCheckLine,
  RiCloseLine,
  RiTimeLine,
  RiLoader4Line,
  RiQuestionLine,
  RiTerminalLine,
} from '@remixicon/react';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { VLink } from '@/components/tabs/virtual-link';
import { cn } from '@/lib/utils';
import {
  ciStatusLabel,
  ciStatusClassName,
  reviewDecisionLabel,
  formatRelativeTime,
  summarizeChecks,
} from './pr-helpers';
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
  reviewDecision: string | null;
  updatedAt: string;
  sessionId: string | null;
  taskGroupId: number | null;
  worktreePath: string | null;
}

interface PrListProps {
  prs: PrItem[];
  showRepo: boolean;
  workspaceSlug: string;
  projectSlug: string;
}

function CheckIcon({ conclusion }: { conclusion: string | null }) {
  const lower = conclusion?.toLowerCase();
  if (lower === 'success' || lower === 'skipped' || lower === 'neutral') {
    return <RiCheckLine className="size-3 text-green-400 shrink-0" />;
  }
  if (
    lower === 'failure' ||
    lower === 'timed_out' ||
    lower === 'cancelled' ||
    lower === 'action_required'
  ) {
    return <RiCloseLine className="size-3 text-red-400 shrink-0" />;
  }
  return <RiLoader4Line className="size-3 text-amber-400 shrink-0 animate-spin" />;
}

function ChecksPopover({ checks }: { checks: GhPrCheck[] }) {
  const summary = summarizeChecks(checks);

  const triggerLabel =
    summary.total === 0
      ? 'No checks'
      : `${summary.passing}/${summary.total} passed`;

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
            <div key={i} className="flex items-start gap-2 px-3 py-2">
              <CheckIcon conclusion={check.conclusion} />
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

function ReviewDecisionBadge({ decision }: { decision: string | null }) {
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

export function PrList({ prs, showRepo, workspaceSlug, projectSlug }: PrListProps) {
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
}

function PrRow({ pr, showRepo, workspaceSlug, projectSlug }: PrRowProps) {
  const diffsHref = `/w/${workspaceSlug}/projects/${projectSlug}/diffs`;

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 hover:bg-muted/30 transition-colors">
      {/* Row 1: title + badges + time */}
      <div className="flex items-start gap-2 min-w-0">
        <div className="flex min-w-0 flex-1 items-center gap-2 flex-wrap">
          <a
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-foreground hover:underline flex items-center gap-1 min-w-0"
          >
            <span className="truncate">{pr.title}</span>
            <RiExternalLinkLine className="size-3 shrink-0 text-muted-foreground" />
          </a>
          {pr.isDraft && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 text-muted-foreground">
              <RiDraftLine className="size-2.5" />
              Draft
            </Badge>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(pr.updatedAt)}</span>
      </div>

      {/* Row 2: meta — repo, number, author, branch */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
        {showRepo && (
          <span className="font-mono text-foreground/70 truncate max-w-[160px]">{pr.repo.split('/').pop()}</span>
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

      {/* Row 3: CI status, review decision, checks, session link */}
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-none border px-1.5 py-0.5 text-[10px] font-medium',
            ciStatusClassName(pr.ciStatus),
          )}
        >
          <CiStatusIcon status={pr.ciStatus} />
          {ciStatusLabel(pr.ciStatus)}
        </span>

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
                <span>Session active</span>
              </VLink>
            </TooltipTrigger>
            <TooltipContent>
              Open in Diffs tab — worktree at {pr.worktreePath}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
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
