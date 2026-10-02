'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  RiErrorWarningLine,
  RiInbox2Line,
  RiKeyboardLine,
  RiRefreshLine,
  RiSearchLine,
} from '@remixicon/react';
import { toast } from 'sonner';
import { ThreePanelLayout, type ShortcutDef } from '@/components/layout/three-panel-layout';
import {
  useOptionalTab,
  useVirtualNavigate,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { PrErrorStrip } from '@/components/prs/pr-error-strip';
import { useKeptReviews } from '@/components/prs/use-kept-reviews';
import { ReviewPage } from '@/components/review/review-page';
import { reviewUrlParams } from '@/components/review/review-url-params';
import type { ReviewTab } from '@/components/review/review-helpers';
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
import { buildPrsPath } from '@/lib/review-path';
import {
  defaultInboxTab,
  describeCleared,
  filterInboxItems,
  moveSelection,
  nextSelectionAfterRemoval,
  selectionAfterMarkRead,
  pickReviewProject,
  prKey,
  shouldStartReadDwell,
  sortInboxRows,
  unreadPriorityCount,
  visibleItemIds,
  type InboxTab,
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
import { useContainerNarrow } from '@/hooks/use-container-narrow';
import { useInboxKeys } from './use-inbox-keys';


const READ_DWELL_MS = 1500;
const ALL_WORKSPACES = 'all';

const LIST_SIDEBAR_CONFIG = {
  defaultWidth: 360,
  minWidth: 260,
  maxWidth: 640,
  storageKey: 'engy-prs-list-sidebar-width',
} as const;
const LIST_SIDEBAR_SHORTCUT: ShortcutDef = { mod: true, shift: true, key: ';' };

interface InboxViewProps {
  scope?: { workspaceId: number; projectSlug: string };
}

export function InboxView({ scope }: InboxViewProps) {
  const lockedWorkspaceId = scope?.workspaceId;
  const navigate = useVirtualNavigate();
  const isTabActive = useOptionalTab()?.isActive ?? true;
  const utils = trpc.useUtils();
  const isLocked = lockedWorkspaceId !== undefined;

  const [tab, setTab] = useState<InboxTab>(() => defaultInboxTab(isLocked));
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_WORKSPACES);
  const [query, setQuery] = useState('');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [listCollapsed, setListCollapsed] = useState(false);
  const search = useVirtualSearchParams();
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
    includeSnoozed: tab === 'mine' || displayOptions.showSnoozed,
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

  const unsortedRows =
    tab === 'mine' && lockedWorkspaceId !== undefined
      ? myPullRequestRows(lockedPrData?.prs ?? [], items, lockedWorkspaceId)
      : items.map((item) =>
          inboxItemToRow(item, prByKey.get(prKey(item.repoFullName, item.prNumber))),
        );
  const rows = sortInboxRows(unsortedRows, displayOptions.sort, displayOptions.unreadFirst);
  const visibleRows = filterInboxItems(rows, query);
  function markVisibleRead() {
    if (tab === 'mine') return;
    markAllRead({
      tab,
      workspaceId,
      includeSnoozed: displayOptions.showSnoozed,
      ids: visibleItemIds(visibleRows),
    });
  }

  function clearVisible(onlyRead: boolean) {
    if (tab === 'mine') return;
    markAllDone({
      tab,
      workspaceId,
      includeSnoozed: displayOptions.showSnoozed,
      ids: visibleItemIds(visibleRows, onlyRead),
    });
  }

  const { repo: openRepo, pr: openNumber } = reviewUrlParams(search);
  const openPr =
    scope && openRepo && openNumber ? { repoFullName: openRepo, prNumber: openNumber } : null;
  const openKey = openPr ? prKey(openPr.repoFullName, openPr.prNumber) : null;
  const activeKey = openKey ?? selectedKey;
  const selected =
    visibleRows.find((row) => row.key === activeKey) ??
    (isNarrow || openKey ? null : visibleRows[0]) ??
    null;
  const selectedItem = selected?.item ?? null;

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  const dwellKey = shouldStartReadDwell(activeKey, selected?.key ?? null, isTabActive)
    ? activeKey
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

  const prsTabSlug =
    lockedWorkspaceId === undefined ? null : (workspaceSlugById.get(lockedWorkspaceId) ?? null);
  const reviewSlug =
    selected?.workspaceId == null ? null : (workspaceSlugById.get(selected.workspaceId) ?? null);
  const diffsHref =
    reviewSlug && selected?.projectSlug
      ? `/w/${reviewSlug}/projects/${selected.projectSlug}/diffs`
      : null;

  const globalProjectsWorkspaceId = scope ? undefined : (selected?.workspaceId ?? undefined);
  const { data: globalProjects = [] } = trpc.project.list.useQuery(
    { workspaceId: globalProjectsWorkspaceId ?? 0 },
    { enabled: globalProjectsWorkspaceId !== undefined },
  );
  const reviewProjectSlug = scope
    ? scope.projectSlug
    : pickReviewProject(globalProjects, selected?.projectSlug ?? null);
  const canReview = reviewSlug !== null && reviewProjectSlug !== null;

  const pushReview = useCallback(
    (pr: { repoFullName: string; prNumber: number } | null) => {
      if (!scope || !prsTabSlug) return;
      navigate.push(buildPrsPath(prsTabSlug, scope.projectSlug, pr, search));
    },
    [navigate, prsTabSlug, scope, search],
  );

  function openReview() {
    if (!selected || !reviewSlug || !reviewProjectSlug) return;
    const pr = { repoFullName: selected.repoFullName, prNumber: selected.prNumber };
    if (scope) pushReview(pr);
    else navigate.openNewTab(buildPrsPath(reviewSlug, reviewProjectSlug, pr));
  }

  function closeReview() {
    pushReview(null);
  }

  function selectKey(key: string | null) {
    setSelectedKey(key);
    if (!openKey) return;
    const row = visibleRows.find((visible) => visible.key === key);
    if (row) pushReview({ repoFullName: row.repoFullName, prNumber: row.prNumber });
    else closeReview();
  }

  const handleReviewTab = useCallback((tab: ReviewTab) => setListCollapsed(tab === 'files'), []);

  function removeRow(row: InboxRowModel, remove: (id: number) => void) {
    if (!row.item) return;
    const keys = visibleRows.map((visible) => visible.key);
    remove(row.item.id);
    if (row.key === selected?.key) selectKey(nextSelectionAfterRemoval(keys, row.key));
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

  function toggleSelectedRead(row: InboxRowModel) {
    if (!row.item) return;
    setSelectedKey(selectionAfterMarkRead(selectedKey, row.key, row.item.unread));
    toggleRead(row.item);
  }

  function moveBy(delta: 1 | -1) {
    const keys = visibleRows.map((row) => row.key);
    const next = moveSelection(keys, selected?.key ?? null, delta);
    if (next !== null) selectKey(next);
  }

  useInboxKeys(
    containerRef,
    isTabActive && !snoozeOpen && !helpOpen,
    {
      next: () => moveBy(1),
      previous: () => moveBy(-1),
      open: openReview,
      close: () => {
        if (openKey) closeReview();
      },
      toggleRead: () => {
        if (selected) toggleSelectedRead(selected);
      },
      markAllRead: markVisibleRead,
      done: () => removeSelected((id) => markDone({ id })),
      snooze: () => {
        if (selectedItem) setSnoozeOpen(true);
      },
      github: () => {
        if (selected) window.open(selected.url, '_blank', 'noopener,noreferrer');
      },
      focusFilter: () => filterInputRef.current?.focus(),
      help: () => setHelpOpen(true),
    },
    openKey ? 'review' : 'list',
  );

  function snoozeSelected(until: Date) {
    setSnoozeOpen(false);
    removeSelected((id) => snooze({ id, until: until.toISOString() }));
  }

  function selectRow(key: string) {
    setPreviewOpen(true);
    selectKey(key);
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
        !isNarrow && !openKey && 'w-[26rem] flex-none border-r',
      )}
    >
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={tab} onValueChange={(value) => setTab(value as InboxTab)}>
            <TabsList>
              {isLocked && <TabsTrigger value="mine">My PRs</TabsTrigger>}
              <TabsTrigger value="priority">
                Priority{unreadPriority > 0 ? ` (${unreadPriority})` : ''}
              </TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
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
              totalCount={visibleItemIds(visibleRows).length}
              readCount={visibleItemIds(visibleRows, true).length}
              onMarkAllRead={markVisibleRead}
              onClear={clearVisible}
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
      canReview={canReview}
      onOpenReview={openReview}
      onBack={isNarrow ? () => setPreviewOpen(false) : null}
      diffsHref={diffsHref}
      kept={keptByPr.get(selected.key)}
      onRemoveKept={(id, force) => removeKept({ id, force })}
      onDone={() => removeSelected((id) => markDone({ id }))}
      onSnooze={() => openSnoozeFor(selected)}
      onToggleRead={() => selected && toggleSelectedRead(selected)}
    />
  ) : (
    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      Select an item to preview it
    </div>
  );

  const reviewPane =
    openPr && scope && prsTabSlug ? (
      <ReviewPage
        key={openKey}
        workspaceSlug={prsTabSlug}
        repoFullName={openPr.repoFullName}
        prNumber={openPr.prNumber}
        projectSlug={scope.projectSlug}
        onBack={closeReview}
        onTabChange={handleReviewTab}
      />
    ) : null;

  let panes = (
    <>
      {listPane}
      {previewPane}
    </>
  );
  if (reviewPane && isNarrow) {
    panes = reviewPane;
  } else if (reviewPane) {
    panes = (
      <ThreePanelLayout
        className="min-w-0 flex-1"
        left={LIST_SIDEBAR_CONFIG}
        leftShortcut={LIST_SIDEBAR_SHORTCUT}
        leftCollapsed={listCollapsed}
        onLeftCollapsedChange={setListCollapsed}
        leftContent={<div className="flex h-full min-h-0 flex-col">{listPane}</div>}
        centerContent={reviewPane}
      />
    );
  } else if (showPreviewOnly) panes = previewPane;
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
