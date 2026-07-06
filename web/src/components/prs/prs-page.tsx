'use client';

import { useState, useCallback } from 'react';
import { trpc } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PrList } from './pr-list';
import {
  RiRefreshLine,
  RiGitPullRequestLine,
  RiAlertLine,
  RiTerminalLine,
} from '@remixicon/react';
import { cn } from '@/lib/utils';
import { getAttentionInfo } from './pr-attention';
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

function GlobalErrorBanner({ error }: { error: GlobalPrError | { message: string } }) {
  let content: React.ReactNode;
  if (typeof error === 'object') {
    content = (
      <>
        <p className="font-medium text-foreground">Refresh failed</p>
        <p className="text-muted-foreground font-mono">{error.message}</p>
      </>
    );
  } else if (error === 'gh-not-installed') {
    content = (
      <>
        <p className="font-medium text-foreground">GitHub CLI not installed</p>
        <p className="text-muted-foreground">
          Install <code className="font-mono">gh</code> to fetch pull requests.{' '}
          <a
            href="https://cli.github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline"
          >
            cli.github.com
          </a>
        </p>
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
        {error.kind === 'gh-not-authenticated' ? (
          <p className="text-muted-foreground">
            Not authenticated for this repo&apos;s host — run{' '}
            <code className="font-mono bg-muted px-1 py-0.5">gh auth login</code> for it, then
            refresh. Other repos keep updating.
          </p>
        ) : (
          <p className="text-muted-foreground font-mono break-all">{error.message}</p>
        )}
      </div>
    </div>
  );
}

export function PrsPage({ workspaceSlug, projectSlug }: PrsPageProps) {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });

  const workspaceId = workspace?.id ?? 0;
  const workspaceRepos = (workspace?.repos as string[] | null) ?? [];

  const {
    data: prData,
    isLoading,
  } = trpc.pr.list.useQuery({ workspaceId }, { enabled: !!workspace });
  const prs = prData?.prs;
  const { global: globalError, perRepo: repoErrors } = classifyPrRepoErrors(
    prData?.repoErrors ?? {},
  );

  const refetchPrs = useCallback(() => {
    utils.pr.list.invalidate({ workspaceId });
  }, [utils, workspaceId]);

  useOnServerEvent('PR_CHANGE', refetchPrs);

  useOnServerEvent('PR_ATTENTION', (payload) => {
    if (payload.workspaceId !== workspaceId) return;
    const info = getAttentionInfo(payload.reason);
    toast.error(`PR #${payload.prNumber}: ${info?.label ?? 'CI failure needs attention'}`, {
      description: info?.description,
    });
    refetchPrs();
  });

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
          {prs && prs.length > 0 && (
            <span className="text-xs text-muted-foreground">({prs.length})</span>
          )}
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={handleRefresh}
          disabled={isRefreshing || !workspace}
          className={cn(isRefreshing && 'opacity-60')}
        >
          <RiRefreshLine className={cn('size-3', isRefreshing && 'animate-spin')} />
          {isRefreshing ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {/* Global error states: gh missing / daemon down can't differ per repo */}
      {globalError && <GlobalErrorBanner error={globalError} />}
      {mutationError && <GlobalErrorBanner error={{ message: mutationError }} />}

      {/* Body */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Per-repo failures render inline; healthy repos keep listing below */}
        {!globalError && repoErrors.map((error) => <RepoErrorRow key={error.repo} error={error} />)}
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
            <div>
              <p className="text-sm font-medium">No open pull requests</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Click Refresh to fetch the latest PRs from GitHub.
              </p>
            </div>
          </div>
        ) : (
          <PrList
            prs={prs}
            showRepo={workspaceRepos.length > 1}
            workspaceSlug={workspaceSlug}
            projectSlug={projectSlug}
          />
        )}
      </div>
    </div>
  );
}
