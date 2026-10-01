'use client';

import { useState, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';
import { Button } from '@/components/ui/button';
import { PrList } from './pr-list';
import {
  RiRefreshLine,
  RiGitPullRequestLine,
  RiAlertLine,
  RiTerminalLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { isPrOutstanding } from '@/lib/pr-outstanding';
import {
  coercePrScope,
  filterPrsByScope,
  sortByClosestToShipping,
  type PrScope,
} from './pr-helpers';
import { usePrInbox } from './use-pr-inbox';
import { useKeptReviews } from './use-kept-reviews';
import {
  classifyPrRepoErrors,
  repoDisplayName,
  type GlobalPrError,
  type RepoPrError,
} from './pr-errors';

interface PrsPageProps {
  workspaceSlug: string;
  projectSlug: string;
}

function GlobalErrorBanner({
  error,
}: {
  error: GlobalPrError | { title: string; message: string };
}) {
  let content: React.ReactNode;
  if (typeof error === 'object') {
    content = (
      <>
        <p className="font-medium text-foreground">{error.title}</p>
        <p className="text-muted-foreground font-mono">{error.message}</p>
      </>
    );
  } else {
    content = (
      <>
        <p className="font-medium text-foreground">Daemon not connected</p>
        <p className="text-muted-foreground">
          Start the Engy client daemon to fetch pull requests.
        </p>
      </>
    );
  }

  return (
    <div className="flex items-start gap-3 border border-amber-400/20 bg-amber-400/5 px-4 py-3 text-xs">
      <RiAlertLine className="size-4 shrink-0 text-amber-400 mt-0.5" />
      <div className="space-y-1">{content}</div>
    </div>
  );
}

function RepoErrorRow({ error }: { error: RepoPrError }) {
  return (
    <div className="flex items-start gap-3 border-b border-border bg-amber-400/5 px-4 py-2 text-xs">
      <RiAlertLine className="size-3.5 shrink-0 text-amber-400 mt-0.5" />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium text-foreground font-mono truncate">
          {repoDisplayName(error.repo)}
        </p>
        <p className="text-muted-foreground font-mono break-all">{error.message}</p>
      </div>
    </div>
  );
}

const SCOPE_TEXT: Record<
  PrScope,
  { emptyTitle: string; summary: (n: number) => string; showAction: string }
> = {
  mine: {
    emptyTitle: 'No open pull requests of yours',
    summary: (n) => `${n} open ${n === 1 ? 'PR is' : 'PRs are'} yours.`,
    showAction: 'Show my PRs',
  },
  review: {
    emptyTitle: 'No reviews requested from you',
    summary: (n) => `${n} open ${n === 1 ? 'PR is' : 'PRs are'} waiting for your review.`,
    showAction: 'Show review requests',
  },
};

interface ScopeCount {
  outstanding: number;
  total: number;
}

function ScopeToggle({
  scope,
  onChange,
  counts,
}: {
  scope: PrScope;
  onChange: (scope: PrScope) => void;
  counts: Record<PrScope, ScopeCount>;
}) {
  const options: Array<{ value: PrScope; label: string }> = [
    { value: 'mine', label: 'Mine' },
    { value: 'review', label: 'Review' },
  ];

  return (
    <div className="flex items-center border border-border">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            'px-2 py-0.5 text-xs transition-colors cursor-pointer',
            scope === option.value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
          <span className="ml-1 text-muted-foreground">
            {counts[option.value].outstanding} / {counts[option.value].total}
          </span>
        </button>
      ))}
    </div>
  );
}

export function PrsPage({ workspaceSlug, projectSlug }: PrsPageProps) {
  const [mutationError, setMutationError] = useState<string | null>(null);
  // Null until the user picks: the workspace's configured scope is the default,
  // and a pick only overrides it for this visit.
  const [scopeOverride, setScopeOverride] = useState<PrScope | null>(null);
  const utils = trpc.useUtils();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: githubStatus } = trpc.github.status.useQuery();
  const githubUnavailable = githubStatus && !githubStatus.available ? githubStatus : null;

  const workspaceId = workspace?.id ?? 0;
  const workspaceRepos = (workspace?.repos as string[] | null) ?? [];
  const scope = scopeOverride ?? coercePrScope(workspace?.prScope);
  const otherScope: PrScope = scope === 'mine' ? 'review' : 'mine';

  const {
    data: prData,
    isLoading,
  } = trpc.pr.list.useQuery({ workspaceId }, { enabled: !!workspace });
  const allPrs = prData?.prs;
  const prs = allPrs && sortByClosestToShipping(filterPrsByScope(allPrs, scope));
  const viewerLogin = githubStatus?.available ? githubStatus.login : null;
  const scopeCounts = (scopeToCount: PrScope): ScopeCount => {
    const scoped = allPrs ? filterPrsByScope(allPrs, scopeToCount) : [];
    return {
      outstanding: scoped.filter((pr) => isPrOutstanding(pr, viewerLogin)).length,
      total: scoped.length,
    };
  };
  const { unreadItemIds, markRead } = usePrInbox(workspaceId, !!workspace);
  const { keptByPr, removeKept } = useKeptReviews(workspaceId, !!workspace);
  const { global: globalError, perRepo: repoErrors } = classifyPrRepoErrors(
    prData?.repoErrors ?? {},
  );

  const refetchPrs = useCallback(() => {
    utils.pr.list.invalidate({ workspaceId });
  }, [utils, workspaceId]);

  useOnServerEvent('PR_CHANGE', refetchPrs);

  const refreshMutation = trpc.pr.refresh.useMutation({
    // Success or partial failure: list re-fetch picks up rows AND repoErrors.
    onSuccess: () => refetchPrs(),
    onError: (err) => setMutationError(err.message),
  });

  const handleRefresh = () => {
    if (!workspace) return;
    setMutationError(null);
    refreshMutation.mutate({ workspaceId });
  };

  const isRefreshing = refreshMutation.isPending;

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <RiGitPullRequestLine className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">Open Pull Requests</span>
          {allPrs && allPrs.length > 0 && (
            <ScopeToggle
              scope={scope}
              onChange={setScopeOverride}
              counts={{ mine: scopeCounts('mine'), review: scopeCounts('review') }}
            />
          )}
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={handleRefresh}
          disabled={isRefreshing || !workspace || !!githubUnavailable}
          className={cn(isRefreshing && 'opacity-60')}
        >
          <RiRefreshLine className={cn('size-3', isRefreshing && 'animate-spin')} />
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Global error states: GitHub token problems / daemon down can't differ per repo */}
      {githubUnavailable && (
        <GlobalErrorBanner
          error={{ title: 'GitHub unavailable', message: githubUnavailable.message }}
        />
      )}
      {!githubUnavailable && globalError && <GlobalErrorBanner error={globalError} />}
      {!githubUnavailable && mutationError && (
        <GlobalErrorBanner error={{ title: 'Refresh failed', message: mutationError }} />
      )}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Per-repo failures render inline; healthy repos keep listing below */}
        {!githubUnavailable && !globalError && repoErrors.map((error) => <RepoErrorRow key={error.repo} error={error} />)}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <p className="text-sm text-muted-foreground">Loading…</p>
          </div>
        ) : workspaceRepos.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center px-4">
            <RiTerminalLine className="size-8 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium">No repositories configured</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Add repositories to this workspace to track pull requests.
              </p>
            </div>
          </div>
        ) : !prs || prs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center px-4">
            <RiGitPullRequestLine className="size-8 text-muted-foreground/40" />
            {allPrs && allPrs.length > 0 ? (
              <div>
                <p className="text-sm font-medium">{SCOPE_TEXT[scope].emptyTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {SCOPE_TEXT[otherScope].summary(allPrs.length)}
                </p>
                <Button
                  variant="outline"
                  size="xs"
                  className="mt-3"
                  onClick={() => setScopeOverride(otherScope)}
                >
                  {SCOPE_TEXT[otherScope].showAction}
                </Button>
              </div>
            ) : (
              <div>
                <p className="text-sm font-medium">No open pull requests</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Click Refresh to fetch the latest PRs from GitHub.
                </p>
              </div>
            )}
          </div>
        ) : (
          <PrList
            prs={prs}
            showRepo={workspaceRepos.length > 1}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
            unreadItemIds={unreadItemIds}
            keptByPr={keptByPr}
            onRemoveKept={(id) => removeKept({ id })}
            onOpen={(inboxItemId) => markRead({ id: inboxItemId })}
          />
        )}
      </div>
    </div>
  );
}
