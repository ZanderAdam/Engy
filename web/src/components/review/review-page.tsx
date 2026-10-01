'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { RiAlertLine, RiLoader4Line } from '@remixicon/react';
import { trpc, type RouterOutputs } from '@/lib/trpc';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Kbd } from '@/components/ui/kbd';
import { useSendToTerminal } from '@/components/terminal/use-send-to-terminal';
import { ReviewHeader } from './review-header';
import { ReviewOverview } from './review-overview';
import { ReviewChecks } from './review-checks';
import { ReviewSidebar } from './review-sidebar';
import { ReviewWorktreeBanner } from './review-worktree-banner';
import { isBehindGithub, REVIEW_TABS, type ReviewTab } from './review-helpers';
import { useReviewTabKeys } from './use-review-tab-keys';

type OpenedWorktree = RouterOutputs['review']['open'];

interface ReviewFilesContext {
  workspaceSlug: string;
  workspaceId: number;
  projectSlug: string | null;
  repoFullName: string;
  prNumber: number;
  worktreePath: string;
  headRefName: string;
  baseRef: string | null;
  headSha: string;
}

interface ReviewPageProps {
  workspaceSlug: string;
  repoFullName: string;
  prNumber: number;
  projectSlug: string | null;
  renderFiles?: (context: ReviewFilesContext) => ReactNode;
}

function StatusMessage({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-20 text-center">
      {icon}
      <p className="text-sm font-medium">{title}</p>
      {children}
    </div>
  );
}

function FilesPlaceholder() {
  return <p className="px-4 py-6 text-xs text-muted-foreground">Files</p>;
}

export function ReviewPage({
  workspaceSlug,
  repoFullName,
  prNumber,
  projectSlug,
  renderFiles,
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
    },
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

  if (!githubStatus || !workspace) {
    return (
      <StatusMessage
        icon={<RiLoader4Line className="size-5 animate-spin text-muted-foreground" />}
        title="Loading…"
      />
    );
  }

  if (!githubStatus.available) {
    return (
      <StatusMessage
        icon={<RiAlertLine className="size-5 text-amber-400" />}
        title="GitHub unavailable"
      >
        <p className="max-w-md text-xs text-muted-foreground">{githubStatus.message}</p>
      </StatusMessage>
    );
  }

  if (open.error) {
    return (
      <StatusMessage
        icon={<RiAlertLine className="size-5 text-red-400" />}
        title="Could not open the review"
      >
        <p className="max-w-md break-words font-mono text-xs text-muted-foreground">
          {open.error.message}
        </p>
        <Button variant="outline" size="xs" onClick={startOpen}>
          Retry
        </Button>
      </StatusMessage>
    );
  }

  if (!worktree) {
    return (
      <StatusMessage
        icon={<RiLoader4Line className="size-5 animate-spin text-muted-foreground" />}
        title="Preparing review worktree…"
      >
        <p className="text-xs text-muted-foreground">
          {repoFullName}#{prNumber}
        </p>
      </StatusMessage>
    );
  }

  if (detailQuery.error) {
    return (
      <StatusMessage
        icon={<RiAlertLine className="size-5 text-red-400" />}
        title="Could not load the pull request"
      >
        <p className="max-w-md break-words font-mono text-xs text-muted-foreground">
          {detailQuery.error.message}
        </p>
        <Button variant="outline" size="xs" onClick={() => detailQuery.refetch()}>
          Retry
        </Button>
      </StatusMessage>
    );
  }

  if (!detail) {
    return (
      <StatusMessage
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
            <ReviewOverview detail={detail} />
          </TabsContent>
          <TabsContent value="files" className="flex min-h-0 flex-col">
            {renderFiles ? (
              renderFiles({
                workspaceSlug,
                workspaceId,
                projectSlug,
                repoFullName,
                prNumber,
                worktreePath: worktree.worktreePath,
                headRefName: worktree.headRefName,
                baseRef: worktree.baseRef,
                headSha: worktree.headSha,
              })
            ) : (
              <FilesPlaceholder />
            )}
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
