'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  RiErrorWarningLine,
  RiInbox2Line,
  RiKeyboardLine,
  RiRefreshLine,
  RiSearchLine,
} from '@remixicon/react';
import { toast } from 'sonner';
import { useOptionalTab, useVirtualNavigate } from '@/components/tabs/tab-context';
import { PrErrorStrip } from '@/components/prs/pr-error-strip';
import { useKeptReviews } from '@/components/prs/use-kept-reviews';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useOnServerEvent } from '@/contexts/events-context';
import { cn } from '@/lib/utils';
import { trpc } from '@/lib/trpc';
import { buildReviewPath } from '@/lib/review-path';
import {
  describeCleared,
  filterInboxItems,
  moveSelection,
  nextSelectionAfterRemoval,
  prKey,
  shouldStartReadDwell,
  sortInboxItems,
  unreadPriorityCount,
} from './inbox-helpers';
import {
  inboxItemToRow,
  myPullRequestRows,
  type InboxRowModel,
  type WorkspacePr,
} from './inbox-rows';
import { InboxDisplayOptionsMenu } from './inbox-display-options';
import { InboxKeyHelp } from './inbox-key-help';
import { InboxList } from './inbox-list';
import { InboxMoreMenu } from './inbox-more-menu';
import { InboxPreview } from './inbox-preview';
import { SnoozeMenu } from './snooze-menu';
import { useInboxDisplayOptions } from './use-inbox-display-options';
import { useContainerNarrow } from './use-container-narrow';
import { useInboxKeys } from './use-inbox-keys';

type InboxTab = 'priority' | 'all' | 'mine';

const READ_DWELL_MS = 1500;
const ALL_WORKSPACES = 'all';

interface InboxViewProps {
  workspaceId?: number;
}

export function InboxView({ workspaceId: lockedWorkspaceId }: InboxViewProps) {
  const navigate = useVirtualNavigate();
  const isTabActive = useOptionalTab()?.isActive ?? true;
  const utils = trpc.useUtils();
  const isLocked = lockedWorkspaceId !== undefined;

  const [tab, setTab] = useState<InboxTab>('priority');
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_WORKSPACES);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isNarrow = useContainerNarrow(containerRef);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const { options: displayOptions, update: updateDisplayOptions } = useInboxDisplayOptions();

  const selectedWorkspaceId =
    workspaceFilter === ALL_WORKSPACES ? undefined : Number(workspaceFilter);
  const workspaceId = lockedWorkspaceId ?? selectedWorkspaceId;
  const inboxTab = tab === 'mine' ? 'all' : tab;

  const { data: githubStatus } = trpc.github.status.useQuery();
  const { data: workspaces = [] } = trpc.workspace.list.useQuery();
  const { data: counts } = trpc.inbox.counts.useQuery();
  const { data: items = [], isLoading: isInboxLoading } = trpc.inbox.list.useQuery({
    tab: inboxTab,
    workspaceId,
    includeSnoozed: displayOptions.showSnoozed,
  });

  function refresh() {
    void utils.inbox.invalidate();
  }

  const mutationOptions = {
    onSuccess: refresh,
    onError: (err: { message: string }) => toast.error(err.message),
  };
  const { mutate: markRead } = trpc.inbox.markRead.useMutation(mutationOptions);
  const { mutate: markUnread } = trpc.inbox.markUnread.useMutation(mutationOptions);
  const { mutate: markDone } = trpc.inbox.markDone.useMutation(mutationOptions);
  const { mutate: snooze } = trpc.inbox.snooze.useMutation(mutationOptions);
  const { mutate: markAllRead } = trpc.inbox.markAllRead.useMutation({
    ...mutationOptions,
    onSuccess: ({ count }) => {
      refresh();
      toast.success(count === 1 ? 'Marked 1 item read' : `Marked ${count} items read`);
    },
  });
  const { mutate: markAllDone } = trpc.inbox.markAllDone.useMutation({
    ...mutationOptions,
    onSuccess: ({ count, githubFailures }) => {
      refresh();
      const message = describeCleared(count, githubFailures);
      if (githubFailures > 0) toast.warning(message);
      else toast.success(message);
    },
  });
  const { mutate: refreshPrs, isPending: isRefreshingPrs } = trpc.pr.refresh.useMutation({
    onSuccess: () => void utils.pr.list.invalidate(),
    onError: (err) => toast.error(`Refresh failed: ${err.message}`),
  });
  const { keptByPr, removeKept } = useKeptReviews(lockedWorkspaceId ?? 0, isLocked);

  useOnServerEvent('PR_CHANGE', () => void utils.pr.list.invalidate());

  const unreadPriority = counts ? unreadPriorityCount(counts, workspaceId) : 0;

  const prWorkspaceIds = useMemo(() => {
    if (lockedWorkspaceId !== undefined) return [lockedWorkspaceId];
    return [
      ...new Set(items.flatMap((item) => (item.workspaceId === null ? [] : [item.workspaceId]))),
    ];
  }, [items, lockedWorkspaceId]);
  const prQueries = trpc.useQueries((t) =>
    prWorkspaceIds.map((id) => t.pr.list({ workspaceId: id })),
  );
  const prByKey = new Map<string, WorkspacePr>();
  for (const result of prQueries) {
    for (const pr of result.data?.prs ?? []) {
      if (pr.repoFullName !== null) prByKey.set(prKey(pr.repoFullName, pr.number), pr);
    }
  }
  const lockedPrData = isLocked ? prQueries[0]?.data : undefined;

  const sortedItems = useMemo(
    () => sortInboxItems(items, displayOptions.unreadFirst),
    [items, displayOptions.unreadFirst],
  );
  const rows =
    tab === 'mine' && lockedWorkspaceId !== undefined
      ? myPullRequestRows(lockedPrData?.prs ?? [], items, lockedWorkspaceId)
      : sortedItems.map((item) =>
          inboxItemToRow(item, prByKey.get(prKey(item.repoFullName, item.prNumber))),
        );
  const visibleRows = filterInboxItems(rows, query);
  const selected =
    visibleRows.find((row) => row.key === selectedKey) ??
    (isNarrow ? null : visibleRows[0]) ??
    null;
  const selectedItem = selected?.item ?? null;

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  const dwellKey = shouldStartReadDwell(selectedKey, selected?.key ?? null, isTabActive)
    ? selectedKey
    : null;
  useEffect(() => {
    if (dwellKey === null) return;
    const timer = setTimeout(() => {
      const current = selectedRef.current;
      if (current?.key === dwellKey && current.item?.unread) markRead({ id: current.item.id });
    }, READ_DWELL_MS);
    return () => clearTimeout(timer);
  }, [dwellKey, markRead]);

  const workspaceSlugById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.slug])),
    [workspaces],
  );
  const lockedWorkspaceRepos = workspaces.find((workspace) => workspace.id === lockedWorkspaceId)
    ?.repos as string[] | null | undefined;

  const reviewSlug =
    selected?.workspaceId == null ? null : (workspaceSlugById.get(selected.workspaceId) ?? null);
  const diffsHref =
    reviewSlug && selected?.projectSlug
      ? `/w/${reviewSlug}/projects/${selected.projectSlug}/diffs`
      : null;

  function openReview() {
    if (!selected || !reviewSlug) return;
    navigate.push(
      buildReviewPath(
        reviewSlug,
        selected.repoFullName,
        selected.prNumber,
        selected.projectSlug ?? undefined,
      ),
    );
  }

  function removeRow(row: InboxRowModel, remove: (id: number) => void) {
    if (!row.item) return;
    const keys = visibleRows.map((visible) => visible.key);
    remove(row.item.id);
    if (row.key === selected?.key) setSelectedKey(nextSelectionAfterRemoval(keys, row.key));
  }

  function removeSelected(remove: (id: number) => void) {
    if (selected) removeRow(selected, remove);
  }

  function openSnoozeFor(row: InboxRowModel) {
    setSelectedKey(row.key);
    setSnoozeOpen(true);
  }

  function toggleRead(item: NonNullable<InboxRowModel['item']>) {
    if (item.unread) markRead({ id: item.id });
    else markUnread({ id: item.id });
  }

  function moveBy(delta: 1 | -1) {
    const keys = visibleRows.map((row) => row.key);
    const next = moveSelection(keys, selected?.key ?? null, delta);
    if (next !== null) setSelectedKey(next);
  }

  useInboxKeys(containerRef, isTabActive && !snoozeOpen && !helpOpen, {
    next: () => moveBy(1),
    previous: () => moveBy(-1),
    open: openReview,
    toggleRead: () => {
      if (selectedItem) toggleRead(selectedItem);
    },
    markAllRead: () => {
      if (tab !== 'mine') markAllRead({ tab, workspaceId });
    },
    done: () => removeSelected((id) => markDone({ id })),
    snooze: () => {
      if (selectedItem) setSnoozeOpen(true);
    },
    github: () => {
      if (selected) window.open(selected.url, '_blank', 'noopener,noreferrer');
    },
    focusFilter: () => filterInputRef.current?.focus(),
    help: () => setHelpOpen(true),
  });

  function snoozeSelected(until: Date) {
    setSnoozeOpen(false);
    removeSelected((id) => snooze({ id, until: until.toISOString() }));
  }

  function selectRow(key: string) {
    setSelectedKey(key);
    setPreviewOpen(true);
  }

  const showPreviewOnly = isNarrow && previewOpen && selected !== null;
  const githubUnavailable = githubStatus && !githubStatus.available ? githubStatus.message : null;

  const isLoading = tab === 'mine' ? (prQueries[0]?.isLoading ?? false) : isInboxLoading;
  let emptyMessage = 'Nothing here';
  if (isLoading) emptyMessage = 'Loading...';
  else if (query) emptyMessage = 'No matching items';
  else if (tab === 'mine') {
    emptyMessage = lockedWorkspaceRepos?.length
      ? 'No open pull requests of yours'
      : 'No repositories configured for this workspace';
  }

  const listPane = (
    <div
      className={cn(
        'flex min-h-0 min-w-0 flex-1 flex-col border-border',
        !isNarrow && 'w-[26rem] flex-none border-r',
      )}
    >
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={(value) => setTab(value as InboxTab)}>
            <TabsList>
              <TabsTrigger value="priority">
                Priority{unreadPriority > 0 ? ` (${unreadPriority})` : ''}
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
              {isLocked && <TabsTrigger value="mine">My PRs</TabsTrigger>}
            </TabsList>
          </Tabs>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Show inbox keys"
            onClick={() => setHelpOpen(true)}
          >
            <RiKeyboardLine className="size-4" />
          </Button>
          <InboxDisplayOptionsMenu options={displayOptions} onChange={updateDisplayOptions} />
          {tab !== 'mine' && (
            <InboxMoreMenu
              totalCount={items.length}
              readCount={items.filter((item) => !item.unread).length}
              onMarkAllRead={() => markAllRead({ tab, workspaceId })}
              onClear={(onlyRead) =>
                markAllDone({
                  tab,
                  workspaceId,
                  includeSnoozed: displayOptions.showSnoozed,
                  onlyRead,
                })
              }
            />
          )}
          {lockedWorkspaceId !== undefined && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Refresh pull requests"
              disabled={isRefreshingPrs || !!githubUnavailable}
              onClick={() => refreshPrs({ workspaceId: lockedWorkspaceId })}
            >
              <RiRefreshLine className={cn('size-4', isRefreshingPrs && 'animate-spin')} />
            </Button>
          )}
          {!isLocked && (
            <Select value={workspaceFilter} onValueChange={setWorkspaceFilter}>
              <SelectTrigger size="sm" className="min-w-0 max-w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_WORKSPACES}>All workspaces</SelectItem>
                {workspaces.map((workspace) => (
                  <SelectItem key={workspace.id} value={String(workspace.id)}>
                    {workspace.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <div className="relative">
          <RiSearchLine className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={filterInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by title or repo"
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>
      {isLocked && !githubUnavailable && (
        <PrErrorStrip repoErrors={lockedPrData?.repoErrors ?? {}} />
      )}
      {visibleRows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <RiInbox2Line className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <InboxList
          rows={visibleRows}
          selectedKey={selected?.key ?? null}
          onSelect={selectRow}
          onDone={(row) => removeRow(row, (id) => markDone({ id }))}
          onSnooze={openSnoozeFor}
        />
      )}
    </div>
  );

  const previewPane = selected ? (
    <InboxPreview
      row={selected}
      canReview={reviewSlug !== null}
      onOpenReview={openReview}
      onBack={isNarrow ? () => setPreviewOpen(false) : null}
      diffsHref={diffsHref}
      kept={keptByPr.get(selected.key)}
      onRemoveKept={(id, force) => removeKept({ id, force })}
      onDone={() => removeSelected((id) => markDone({ id }))}
      onSnooze={() => openSnoozeFor(selected)}
      onToggleRead={() => selectedItem && toggleRead(selectedItem)}
    />
  ) : (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Select an item to preview it
    </div>
  );

  let panes = (
    <>
      {listPane}
      {previewPane}
    </>
  );
  if (showPreviewOnly) panes = previewPane;
  else if (isNarrow) panes = listPane;

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
      {githubUnavailable && (
        <div className="flex items-start gap-2 border-b border-border bg-amber-400/10 px-4 py-2 text-xs text-amber-400">
          <RiErrorWarningLine className="mt-0.5 size-4 shrink-0" />
          <span>{githubUnavailable}</span>
        </div>
      )}
      <div className="flex min-h-0 flex-1">{panes}</div>
      <SnoozeMenu open={snoozeOpen} onOpenChange={setSnoozeOpen} onSnooze={snoozeSelected} />
      <InboxKeyHelp open={helpOpen} onOpenChange={setHelpOpen} />
    </div>
  );
}
