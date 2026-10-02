'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RiAlertLine, RiGitBranchLine, RiLoader4Line, RiTerminalBoxLine } from '@remixicon/react';
import { toast } from 'sonner';
import { trpc, type RouterOutputs } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { useOnServerEvent } from '@/contexts/events-context';
import { useContainerNarrow } from '@/hooks/use-container-narrow';
import { refreshDiff } from '@/components/diff/diff-refresh';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { projectGroupKey } from '@/components/terminal/group-key';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { ReviewAgentControls } from './review-agent-controls';
import { ReviewHeader } from './review-header';
import { ReviewOverview } from './review-overview';
import { ReviewChecks } from './review-checks';
import { ReviewSidebar } from './review-sidebar';
import { ReviewWorktreeBanner } from './review-worktree-banner';
import { ReviewErrorMessage, ReviewStatusMessage } from './review-status-message';
import { isBehindGithub, isPrChangeForReview, REVIEW_TABS, type ReviewTab } from './review-helpers';
import { useReviewTabKeys } from './use-review-tab-keys';
import { ReviewFiles } from './review-files';
import { SubmitReviewPanel } from './submit-review-panel';

type OpenedWorktree = RouterOutputs['review']['open'];

function WorktreeLoading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <ReviewErrorMessage title="Could not open the review" message={error} onRetry={onRetry} />
    );
  }
  return (
    <ReviewStatusMessage
      icon={<RiLoader4Line className="size-5 animate-spin text-muted-foreground" />}
      title="Preparing review worktree…"
    />
  );
}

interface ReviewPageProps {
  workspaceSlug: string;
  repoFullName: string;
  prNumber: number;
  projectSlug: string;
  onBack: () => void;
  onTabChange?: (tab: ReviewTab) => void;
}

export function ReviewPage(props: ReviewPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isNarrow = useContainerNarrow(containerRef);
  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      <ReviewPageBody {...props} isNarrow={isNarrow} />
    </div>
  );
}

function ReviewPageBody({
  isNarrow,
  workspaceSlug,
  repoFullName,
  prNumber,
  projectSlug,
  onBack,
  onTabChange,
}: ReviewPageProps & { isNarrow: boolean }) {
  const [tab, setTab] = useState<ReviewTab>('overview');
  const [worktree, setWorktree] = useState<OpenedWorktree | null>(null);
  const [keptLocalChanges, setKeptLocalChanges] = useState(false);
  const openStarted = useRef(false);
  const utils = trpc.useUtils();
  const { openNewTerminal } = useSendToTerminal();

  useReviewTabKeys(setTab);
  useEffect(() => {
    onTabChange?.(tab);
  }, [tab, onTabChange]);

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
    onError: (error) => {
      openStarted.current = false;
      toast.error(error.message);
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

  const canOpenWorktree = !!workspace && githubAvailable;
  const requestOpen = useCallback(() => {
    if (!canOpenWorktree || openStarted.current) return;
    openStarted.current = true;
    startOpen();
  }, [canOpenWorktree, startOpen]);

  useEffect(() => {
    if (tab === 'files') requestOpen();
  }, [tab, requestOpen]);

  const ready = !!workspace && githubAvailable;
  const detailQuery = trpc.review.detail.useQuery(prInput, { enabled: ready });
  const { data: prList } = trpc.pr.list.useQuery({ workspaceId }, { enabled: !!workspace });
  const listed = prList?.prs.find(
    (pr) => pr.repoFullName === repoFullName && pr.number === prNumber,
  );
  const detail = detailQuery.data;

  useOnServerEvent('PR_CHANGE', (payload) => {
    if (!isPrChangeForReview(payload, workspaceId, worktree?.repoPath ?? null)) return;
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

  const showBanner =
    worktree !== null &&
    (worktree.stale || isBehindGithub(worktree.headSha, detail.headRefOid)) &&
    !(worktree.dirty && keptLocalChanges);
  const isFilesTab = tab === 'files';
  const tabsList = (
    <TabsList
      variant="line"
      className={cn('justify-start px-2', !isFilesTab && 'w-full border-b border-border')}
    >
      {REVIEW_TABS.map(({ value, label, key }) => (
        <TabsTrigger key={value} value={value} className="flex-none">
          {label}
          {!isNarrow && <Kbd>{key}</Kbd>}
        </TabsTrigger>
      ))}
    </TabsList>
  );
  const sidebar = (
    <ReviewSidebar
      detail={detail}
      worktreePath={worktree?.worktreePath ?? null}
      linkedWork={listed ? { sessionId: listed.sessionId, taskGroupId: listed.taskGroupId } : null}
    />
  );

  const worktreeActions = worktree ? (
    <>
      <Button
        variant="outline"
        size={isFilesTab ? 'icon-xs' : 'xs'}
        aria-label="Open terminal here"
        title="Open terminal here"
        onClick={() =>
          openNewTerminal({
            scopeType: 'worktree',
            scopeLabel: `PR #${prNumber}`,
            workingDir: worktree.worktreePath,
            groupKey: projectGroupKey(workspaceSlug, projectSlug),
            workspaceSlug,
          })
        }
      >
        <RiTerminalBoxLine className="size-3" />
        {!isFilesTab && 'Open terminal here'}
      </Button>
      <SubmitReviewPanel
        workspaceId={workspaceId}
        repoFullName={repoFullName}
        prNumber={prNumber}
        repoPath={worktree.repoPath}
        headRefName={worktree.headRefName}
        isOwnPr={detail.author?.login === githubStatus.login}
      />
    </>
  ) : (
    <Button variant="outline" size="xs" disabled={open.isPending} onClick={requestOpen}>
      {open.isPending ? (
        <RiLoader4Line className="size-3 animate-spin" />
      ) : (
        <RiGitBranchLine className="size-3" />
      )}
      Open worktree
    </Button>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {worktree && (
        <ReviewWorktreeBanner
          stale={showBanner}
          dirty={worktree.dirty}
          isUpdating={update.isPending}
          onUpdate={(discard) => update.mutate({ id: worktree.id, discard })}
          onKeep={() => setKeptLocalChanges(true)}
        />
      )}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as ReviewTab)}
        className="flex min-h-0 flex-1 flex-col gap-0"
      >
        <ReviewHeader
          prNumber={prNumber}
          detail={detail}
          onBack={onBack}
          agentReview={
            <ReviewAgentControls
              workspaceId={workspaceId}
              workspaceSlug={workspaceSlug}
              repoFullName={repoFullName}
              prNumber={prNumber}
              projectSlug={projectSlug}
              showGuide={!isFilesTab}
            />
          }
          worktreeActions={worktreeActions}
          compact={isFilesTab}
          tabs={isFilesTab ? tabsList : undefined}
        />
        {isNarrow && !isFilesTab && (
          <details className="border-b border-border">
            <summary className="cursor-pointer px-4 py-2 text-xs text-muted-foreground">
              Details
            </summary>
            {sidebar}
          </details>
        )}

        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            {!isFilesTab && tabsList}
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
              {worktree ? (
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
              ) : (
                <WorktreeLoading error={open.error?.message ?? null} onRetry={startOpen} />
              )}
            </TabsContent>
            <TabsContent value="checks" className="min-h-0 overflow-y-auto">
              <ReviewChecks checks={detail.checks} />
            </TabsContent>
          </div>
          {!isNarrow && !isFilesTab && (
            <aside className="w-72 shrink-0 overflow-y-auto border-l border-border">
              {sidebar}
            </aside>
          )}
        </div>
      </Tabs>
    </div>
  );
}
