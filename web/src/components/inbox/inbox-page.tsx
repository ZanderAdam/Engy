'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { RiErrorWarningLine, RiInbox2Line, RiKeyboardLine, RiSearchLine } from '@remixicon/react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
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
import { trpc } from '@/lib/trpc';
import { buildReviewPath } from '@/lib/review-path';
import type { GhPrCiStatus } from '@engy/common';
import {
  filterInboxItems,
  moveSelection,
  nextSelectionAfterRemoval,
  prKey,
  sortInboxItems,
} from './inbox-helpers';
import { InboxDisplayOptionsMenu } from './inbox-display-options';
import { InboxKeyHelp } from './inbox-key-help';
import { InboxList } from './inbox-list';
import { InboxPreview } from './inbox-preview';
import { SnoozeMenu } from './snooze-menu';
import { useInboxDisplayOptions } from './use-inbox-display-options';
import { useInboxKeys } from './use-inbox-keys';

type InboxTab = 'priority' | 'all';

const READ_DWELL_MS = 1500;
const ALL_WORKSPACES = 'all';

export function InboxPage() {
  const isMobile = useIsMobile();
  const navigate = useVirtualNavigate();
  const utils = trpc.useUtils();

  const [tab, setTab] = useState<InboxTab>('priority');
  const [workspaceFilter, setWorkspaceFilter] = useState(ALL_WORKSPACES);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  const { options: displayOptions, update: updateDisplayOptions } = useInboxDisplayOptions();

  const workspaceId = workspaceFilter === ALL_WORKSPACES ? undefined : Number(workspaceFilter);

  const { data: githubStatus } = trpc.github.status.useQuery();
  const { data: workspaces = [] } = trpc.workspace.list.useQuery();
  const { data: counts } = trpc.inbox.counts.useQuery();
  const { data: items = [], isLoading } = trpc.inbox.list.useQuery({
    tab,
    workspaceId,
    includeSnoozed: displayOptions.showSnoozed,
  });

  function refresh() {
    void utils.inbox.list.invalidate();
    void utils.inbox.counts.invalidate();
  }

  const { mutate: markRead } = trpc.inbox.markRead.useMutation({ onSuccess: refresh });
  const { mutate: markUnread } = trpc.inbox.markUnread.useMutation({ onSuccess: refresh });
  const { mutate: markDone } = trpc.inbox.markDone.useMutation({ onSuccess: refresh });
  const { mutate: snooze } = trpc.inbox.snooze.useMutation({ onSuccess: refresh });
  const { mutate: markAllRead } = trpc.inbox.markAllRead.useMutation({
    onSuccess: ({ count }) => {
      refresh();
      toast.success(count === 1 ? 'Marked 1 item read' : `Marked ${count} items read`);
    },
  });

  const visibleItems = useMemo(
    () => sortInboxItems(filterInboxItems(items, query), displayOptions.unreadFirst),
    [items, query, displayOptions.unreadFirst],
  );
  const selected =
    visibleItems.find((item) => item.id === selectedId) ??
    (isMobile ? null : visibleItems[0]) ??
    null;

  const selectedRef = useRef(selected);
  useEffect(() => {
    selectedRef.current = selected;
  });

  const selectedKey = selected?.id ?? null;
  useEffect(() => {
    if (selectedKey === null) return;
    const timer = setTimeout(() => {
      if (selectedRef.current?.id === selectedKey && selectedRef.current.unread) {
        markRead({ id: selectedKey });
      }
    }, READ_DWELL_MS);
    return () => clearTimeout(timer);
  }, [selectedKey, markRead]);

  const workspaceIds = useMemo(
    () => [
      ...new Set(items.flatMap((item) => (item.workspaceId === null ? [] : [item.workspaceId]))),
    ],
    [items],
  );
  const prQueries = trpc.useQueries((t) =>
    workspaceIds.map((id) => t.pr.list({ workspaceId: id })),
  );
  const ciByPr = useMemo(() => {
    const map = new Map<string, GhPrCiStatus>();
    for (const result of prQueries) {
      for (const pr of result.data?.prs ?? []) map.set(prKey(pr.repo, pr.number), pr.ciStatus);
    }
    return map;
  }, [prQueries]);

  const workspaceSlugById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.slug])),
    [workspaces],
  );

  const reviewSlug =
    selected?.workspaceId == null ? null : (workspaceSlugById.get(selected.workspaceId) ?? null);

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

  function removeSelected(remove: (id: number) => void) {
    if (!selected) return;
    const ids = visibleItems.map((item) => item.id);
    remove(selected.id);
    setSelectedId(nextSelectionAfterRemoval(ids, selected.id));
  }

  function moveBy(delta: 1 | -1) {
    const ids = visibleItems.map((item) => item.id);
    const next = moveSelection(ids, selected?.id ?? null, delta);
    if (next !== null) setSelectedId(next);
  }

  useInboxKeys(containerRef, !snoozeOpen && !helpOpen, {
    next: () => moveBy(1),
    previous: () => moveBy(-1),
    open: openReview,
    toggleRead: () => {
      if (!selected) return;
      if (selected.unread) markRead({ id: selected.id });
      else markUnread({ id: selected.id });
    },
    markAllRead: () => markAllRead({ tab, workspaceId }),
    done: () => removeSelected((id) => markDone({ id })),
    snooze: () => {
      if (selected) setSnoozeOpen(true);
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

  function selectItem(id: number) {
    setSelectedId(id);
    setPreviewOpen(true);
  }

  const showPreviewOnly = isMobile && previewOpen && selected !== null;
  const githubUnavailable = githubStatus && !githubStatus.available ? githubStatus.message : null;

  let emptyMessage = 'Nothing here';
  if (isLoading) emptyMessage = 'Loading...';
  else if (query) emptyMessage = 'No matching items';

  const listPane = (
    <div className="flex min-h-0 flex-1 flex-col border-border md:w-[26rem] md:flex-none md:border-r">
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <div className="flex items-center gap-2">
          <Tabs value={tab} onValueChange={(value) => setTab(value as InboxTab)}>
            <TabsList>
              <TabsTrigger value="priority">
                Priority{counts && counts.unreadPriority > 0 ? ` (${counts.unreadPriority})` : ''}
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
      {visibleItems.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <RiInbox2Line className="size-8 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : (
        <InboxList
          items={visibleItems}
          selectedId={selected?.id ?? null}
          ciByPr={ciByPr}
          onSelect={selectItem}
        />
      )}
    </div>
  );

  const previewPane = selected ? (
    <InboxPreview
      item={selected}
      ci={ciByPr.get(prKey(selected.repoFullName, selected.prNumber))}
      canReview={reviewSlug !== null}
      onOpenReview={openReview}
      onBack={isMobile ? () => setPreviewOpen(false) : null}
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
  else if (isMobile) panes = listPane;

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
