'use client';

import { useState, useMemo } from 'react';
import { trpc } from '@/lib/trpc';
import { useOnServerEvent } from '@/contexts/events-context';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MemoryFilters, type MemoryFiltersValue } from './memory-filters';
import { PromoteDialog } from './promote-dialog';
import { RiAddLine, RiArrowUpLine } from '@remixicon/react';
import { cn } from '@/lib/utils';
import { type MemorySelection, type FleetingRecord, SUBTYPE_COLORS } from './types';

export type { MemorySelection };

const DEFAULT_FILTERS: MemoryFiltersValue = {
  search: '',
  subtype: '',
  repo: '',
  tags: [],
  sort: 'date',
};

interface MemoryBrowserProps {
  workspaceSlug: string;
  repos: string[];
  selected: MemorySelection | null;
  onSelect: (selection: MemorySelection) => void;
  onCreateNew?: () => void;
}

function ConfidenceBar({ value }: { value: number | null }) {
  const pct = Math.round((value ?? 1) * 100);
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="w-10 h-1 bg-muted rounded-none overflow-hidden">
        <div
          className="h-full bg-muted-foreground/60 transition-[width]"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground tabular-nums">{pct}%</span>
    </div>
  );
}

function PermanentList({
  workspaceSlug,
  filters,
  selected,
  onSelect,
}: {
  workspaceSlug: string;
  filters: MemoryFiltersValue;
  selected: MemorySelection | null;
  onSelect: (selection: MemorySelection) => void;
}) {
  const { data: memories, isLoading, error } = trpc.memory.list.useQuery({
    workspaceSlug,
    subtype: filters.subtype || undefined,
    repo: filters.repo || undefined,
    tags: filters.tags.length > 0 ? filters.tags : undefined,
    search: filters.search || undefined,
    limit: 100,
    offset: 0,
  });

  const sorted = useMemo(() => {
    if (!memories) return [];
    const copy = [...memories];
    if (filters.sort === 'confidence') {
      copy.sort((a, b) => (b.confidence ?? 1) - (a.confidence ?? 1));
    }
    return copy;
  }, [memories, filters.sort]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 px-4">
        <p className="text-xs text-destructive text-center">Failed to load memories</p>
        <p className="text-[11px] text-muted-foreground text-center">{error.message}</p>
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-muted-foreground">No memories found</p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {sorted.map((mem) => (
        <li key={mem.id}>
          <button
            className={cn(
              'w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:bg-muted/50',
              selected?.kind === 'permanent' && selected.id === mem.id && 'bg-muted/70',
            )}
            onClick={() => onSelect({ id: mem.id, kind: 'permanent' })}
          >
            <div className="flex items-start justify-between gap-2 mb-1">
              <span className="text-xs font-medium leading-tight line-clamp-1 flex-1">
                {mem.title}
              </span>
              <ConfidenceBar value={mem.confidence} />
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2 mb-1.5">
              {mem.content.slice(0, 120)}
              {mem.content.length > 120 && '…'}
            </p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span
                className={cn(
                  'inline-flex items-center h-4 px-1.5 text-[10px] font-medium border',
                  SUBTYPE_COLORS[mem.subtype] ?? 'bg-muted text-muted-foreground',
                )}
              >
                {mem.subtype}
              </span>
              {mem.repo && (
                <span className="inline-flex items-center h-4 px-1.5 text-[10px] font-mono border border-border text-muted-foreground">
                  {mem.repo}
                </span>
              )}
              <span className="ml-auto text-[10px] text-muted-foreground tabular-nums">
                {new Date(mem.createdAt).toLocaleDateString()}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

type FleetingMemory = FleetingRecord;

function ReviewCandidatesList({
  workspaceSlug,
  repos,
  candidates,
  isLoading,
  error,
  selected,
  onSelect,
}: {
  workspaceSlug: string;
  repos: string[];
  candidates: FleetingMemory[] | undefined;
  isLoading: boolean;
  error: { message: string } | null;
  selected: MemorySelection | null;
  onSelect: (selection: MemorySelection) => void;
}) {
  const [promoteTarget, setPromoteTarget] = useState<FleetingMemory | null>(null);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-12 px-4">
        <p className="text-xs text-destructive text-center">Failed to load review candidates</p>
        <p className="text-[11px] text-muted-foreground text-center">{error.message}</p>
      </div>
    );
  }

  if (!candidates?.length) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-muted-foreground">No review candidates</p>
      </div>
    );
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {candidates.map((mem) => (
          <li key={mem.id}>
            <button
              className={cn(
                'w-full text-left px-3 py-2.5 hover:bg-muted/50 transition-colors focus-visible:outline-none focus-visible:bg-muted/50',
                selected?.kind === 'fleeting' && selected.id === mem.id && 'bg-muted/70',
              )}
              onClick={() => onSelect({ id: mem.id, kind: 'fleeting', fleetingData: mem })}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                  {mem.type}
                </span>
                <div className="flex items-center gap-1 ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="h-5 px-1.5 text-[10px] gap-0.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPromoteTarget(mem);
                    }}
                    title="Promote to permanent memory"
                  >
                    <RiArrowUpLine className="size-2.5" />
                    Promote
                  </Button>
                  <span className="text-[10px] text-muted-foreground tabular-nums">
                    {new Date(mem.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-3">
                {mem.content.slice(0, 200)}
                {mem.content.length > 200 && '…'}
              </p>
              {Array.isArray(mem.tags) && mem.tags.length > 0 && (
                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                  {(mem.tags as string[]).map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center h-4 px-1.5 text-[10px] border border-border text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>

      {promoteTarget && (
        <PromoteDialog
          open={!!promoteTarget}
          onOpenChange={(open) => !open && setPromoteTarget(null)}
          fleeting={promoteTarget}
          workspaceSlug={workspaceSlug}
          repos={repos}
        />
      )}
    </>
  );
}

export function MemoryBrowser({
  workspaceSlug,
  repos,
  selected,
  onSelect,
  onCreateNew,
}: MemoryBrowserProps) {
  const [permanentFilters, setPermanentFilters] = useState<MemoryFiltersValue>(DEFAULT_FILTERS);
  const utils = trpc.useUtils();

  const {
    data: reviewCandidates,
    isLoading: candidatesLoading,
    error: candidatesError,
  } = trpc.memory.reviewCandidates.useQuery({ workspaceSlug, limit: 100 });
  const candidateCount = reviewCandidates?.length ?? 0;

  useOnServerEvent('MEMORY_CHANGE', () => {
    utils.memory.list.invalidate();
    utils.memory.reviewCandidates.invalidate();
    utils.memory.get.invalidate();
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Tabs defaultValue="permanent" className="flex flex-col h-full">
        <div className="px-2 pt-2 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-1">
            <TabsList variant="line" className="h-8">
              <TabsTrigger value="permanent" className="text-xs px-2">
                Permanent
              </TabsTrigger>
              <TabsTrigger value="candidates" className="text-xs px-2 gap-1.5">
                Review Candidates
                {candidateCount > 0 && (
                  <Badge variant="secondary" className="h-4 min-w-4 px-1 text-[10px]">
                    {candidateCount}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
            {onCreateNew && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onCreateNew}
                title="Create new memory"
                className="text-muted-foreground"
              >
                <RiAddLine className="size-3.5" />
              </Button>
            )}
          </div>
        </div>

        <TabsContent value="permanent" className="flex flex-col flex-1 min-h-0 mt-0">
          <MemoryFilters
            filters={permanentFilters}
            repos={repos}
            onChange={setPermanentFilters}
          />
          <ScrollArea className="flex-1">
            <PermanentList
              workspaceSlug={workspaceSlug}
              filters={permanentFilters}
              selected={selected}
              onSelect={onSelect}
            />
          </ScrollArea>
        </TabsContent>

        <TabsContent value="candidates" className="flex flex-col flex-1 min-h-0 mt-0">
          <ScrollArea className="flex-1">
            <ReviewCandidatesList
              workspaceSlug={workspaceSlug}
              repos={repos}
              candidates={reviewCandidates as FleetingMemory[] | undefined}
              isLoading={candidatesLoading}
              error={candidatesError}
              selected={selected}
              onSelect={onSelect}
            />
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
