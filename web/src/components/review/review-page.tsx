'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RiAlertLine, RiLoader4Line } from '@remixicon/react';
import { toast } from 'sonner';
import { trpc, type RouterOutputs } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';
import { refreshDiff } from '@/components/diff/diff-refresh';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Kbd } from '@/components/ui/kbd';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { ReviewAgentControls } from './review-agent-controls';
import { ReviewHeader } from './review-header';
import { ReviewOverview } from './review-overview';
import { ReviewChecks } from './review-checks';
import { ReviewSidebar } from './review-sidebar';
import { ReviewWorktreeBanner } from './review-worktree-banner';
import { ReviewErrorMessage, ReviewStatusMessage } from './review-status-message';
import { isBehindGithub, REVIEW_TABS, type ReviewTab } from './review-helpers';
import { useReviewTabKeys } from './use-review-tab-keys';
import { ReviewFiles } from './review-files';
import { SubmitReviewPanel } from './submit-review-panel';

type OpenedWorktree = RouterOutputs['review']['open'];

interface ReviewPageProps {
  workspaceSlug: string;
  repoFullName: string;
  prNumber: number;
  projectSlug: string | null;
}

export function ReviewPage({
  workspaceSlug,
  repoFullName,
  prNumber,
  projectSlug,
}: ReviewPageProps) {
  const [tab, setTab] = useState<ReviewTab>('overview');
  const [worktree, setWorktree] = useState<OpenedWorktree | null>(null);
  const [keptLocalChanges, setKeptLocalChanges] = useState(false);
  const openStarted = useRef(false);
  const utils = trpc.useUtils();
  const { openNewTerminal } = useSendToTerminal();

  useReviewTabKeys(setTab);

  const { data: workspace } = trpc.workspace.get.useQuery({ slug: workspaceSlug });
  const { data: githubStatus } = trpc.github.status.useQuery();
  const workspaceId = workspace?.id ?? 0;
  const githubAvailable = githubStatus?.available === true;
  const prInput = { workspaceId, repoFullName, prNumber };

  const syncThreads = trpc.review.syncThreads.useMutation({
    onSuccess: () => utils.comment.listThreadsByPrefix.invalidate(),
    onError: (error) => toast.error(error.message),
  });
  const open = trpc.review.open.useMutation({
    onSuccess: (opened) => {
      setWorktree(opened);
      syncThreads.mutate(prInput);
    },
  });
  const update = trpc.review.update.useMutation({
    onSuccess: (updated) => {
      setWorktree(updated);
      setKeptLocalChanges(false);
      refreshDiff(utils);
      syncThreads.mutate(prInput);
    },
    onError: (error) => toast.error(error.message),
  });

  const { mutate: openWorktree } = open;
  const startOpen = useCallback(() => {
    openWorktree({ workspaceId, repoFullName, prNumber });
  }, [openWorktree, workspaceId, repoFullName, prNumber]);

  useEffect(() => {
    if (!workspace || !githubAvailable || openStarted.current) return;
    openStarted.current = true;
    startOpen();
  }, [workspace, githubAvailable, startOpen]);

  const ready = !!workspace && githubAvailable;
  const detailQuery = trpc.review.detail.useQuery(prInput, { enabled: ready });
  const { data: prList } = trpc.pr.list.useQuery({ workspaceId }, { enabled: !!workspace });
  const listed = prList?.prs.find(
    (pr) => pr.repoFullName === repoFullName && pr.number === prNumber,
  );
  const detail = detailQuery.data;

  useOnServerEvent('PR_CHANGE', (payload) => {
    if (payload.workspaceId !== workspaceId || payload.repo !== repoFullName) return;
    void utils.review.detail.invalidate();
  });

  if (!githubStatus || !workspace) {
    return (
      <ReviewStatusMessage
        icon={<RiLoader4Line className="size-5 animate-spin text-muted-foreground" />}
        title="Loading…"
      />
    );
  }

  if (!githubStatus.available) {
    return (
      <ReviewStatusMessage
        icon={<RiAlertLine className="size-5 text-amber-400" />}
        title="GitHub unavailable"
      >
        <p className="max-w-md text-xs text-muted-foreground">{githubStatus.message}</p>
      </ReviewStatusMessage>
    );
  }

  if (open.error) {
    return (
      <ReviewErrorMessage
        title="Could not open the review"
        message={open.error.message}
        onRetry={startOpen}
      />
    );
  }

  if (!worktree) {
    return (
      <ReviewStatusMessage
        icon={<RiLoader4Line className="size-5 animate-spin text-muted-foreground" />}
        title="Preparing review worktree…"
      >
        <p className="text-xs text-muted-foreground">
          {repoFullName}#{prNumber}
        </p>
      </ReviewStatusMessage>
    );
  }

  if (detailQuery.error) {
    return (
      <ReviewErrorMessage
        title="Could not load the pull request"
        message={detailQuery.error.message}
        onRetry={() => detailQuery.refetch()}
      />
    );
  }

  if (!detail) {
    return (
      <ReviewStatusMessage
        icon={<RiLoader4Line className="size-5 animate-spin text-muted-foreground" />}
        title="Loading pull request…"
      />
    );
  }

  const behind = isBehindGithub(worktree.headSha, detail.headRefOid);
  const showBanner = (worktree.stale || behind) && !(worktree.dirty && keptLocalChanges);
  const sidebar = (
    <ReviewSidebar
      detail={detail}
      worktreePath={worktree.worktreePath}
      linkedWork={listed ? { sessionId: listed.sessionId, taskGroupId: listed.taskGroupId } : null}
    />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ReviewWorktreeBanner
        stale={showBanner}
        dirty={worktree.dirty}
        isUpdating={update.isPending}
        onUpdate={(discard) => update.mutate({ id: worktree.id, discard })}
        onKeep={() => setKeptLocalChanges(true)}
      />
      <ReviewHeader
        prNumber={prNumber}
        detail={detail}
        agentReview={
          <ReviewAgentControls
            workspaceId={workspaceId}
            workspaceSlug={workspaceSlug}
            repoFullName={repoFullName}
            prNumber={prNumber}
            projectSlug={projectSlug}
          />
        }
        submitReview={
          <SubmitReviewPanel
            workspaceId={workspaceId}
            repoFullName={repoFullName}
            prNumber={prNumber}
            repoPath={worktree.repoPath}
            headRefName={worktree.headRefName}
            isOwnPr={detail.author?.login === githubStatus.login}
          />
        }
        onOpenTerminal={() =>
          openNewTerminal({
            scopeType: 'worktree',
            scopeLabel: `PR #${prNumber}`,
            workingDir: worktree.worktreePath,
            groupKey: `worktree:${workspaceSlug}`,
            workspaceSlug,
          })
        }
      />
      <details className="border-b border-border lg:hidden">
        <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">
          Details
        </summary>
        {sidebar}
      </details>

      <div className="flex min-h-0 flex-1">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(value as ReviewTab)}
          className="min-w-0 flex-1 gap-0"
        >
          <TabsList variant="line" className="w-full justify-start border-b border-border px-2">
            {REVIEW_TABS.map(({ value, label, key }) => (
              <TabsTrigger key={value} value={value} className="flex-none">
                {label}
                <Kbd className="hidden lg:inline-flex">{key}</Kbd>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="overview" className="min-h-0 overflow-y-auto">
            <ReviewOverview
              detail={detail}
              workspaceId={workspaceId}
              repoFullName={repoFullName}
              prNumber={prNumber}
            />
          </TabsContent>
          <TabsContent
            value="files"
            forceMount
            className="flex min-h-0 flex-col data-[state=inactive]:hidden"
          >
            <ReviewFiles
              workspaceSlug={workspaceSlug}
              workspaceId={workspaceId}
              repoFullName={repoFullName}
              prNumber={prNumber}
              projectSlug={projectSlug}
              repoPath={worktree.repoPath}
              worktreePath={worktree.worktreePath}
              headRefName={worktree.headRefName}
              baseRef={worktree.baseRef}
              active={tab === 'files'}
              totalLines={{ added: detail.additions, removed: detail.deletions }}
            />
          </TabsContent>
          <TabsContent value="checks" className="min-h-0 overflow-y-auto">
            <ReviewChecks checks={detail.checks} />
          </TabsContent>
        </Tabs>
        <aside className="hidden w-72 shrink-0 overflow-y-auto border-l border-border lg:block">
          {sidebar}
        </aside>
      </div>
    </div>
  );
}
