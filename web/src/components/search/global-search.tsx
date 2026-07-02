'use client';

import { Fragment, useEffect, useState, type ComponentType } from 'react';
import { parseTaskId } from './task-id';
import { trpc, type RouterOutputs } from '@/lib/trpc';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { useVirtualNavigate } from '@/components/tabs/tab-context';
import { SUBTYPE_COLORS } from '@/components/memory/types';
import { cn } from '@/lib/utils';
import {
  RiFileTextLine,
  RiBrain2Line,
  RiTaskLine,
  RiFolderLine,
  RiStackLine,
  RiCornerDownLeftLine,
  RiArrowUpDownLine,
} from '@remixicon/react';

// lex (BM25) is effectively instant, so the debounce only needs to coalesce
// fast typing — keep it short for a snappy palette feel.
const DEBOUNCE_MS = 150;

const COLLECTION_LABELS: Record<string, string> = {
  system: 'System',
  docs: 'Docs',
  projects: 'Projects',
  memory: 'Memory',
  tasks: 'Tasks',
};

const COLLECTION_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  system: RiStackLine,
  docs: RiFileTextLine,
  projects: RiFolderLine,
  memory: RiBrain2Line,
  tasks: RiTaskLine,
};

const COLLECTION_ORDER = ['tasks', 'projects', 'docs', 'memory', 'system'];

function extractWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^\/w\/([^/?#]+)/.exec(window.location.pathname);
  return match ? match[1] : null;
}

export function buildNavigationPath(workspaceSlug: string, path: string): string {
  if (path.startsWith('task:')) {
    const numericId = parseTaskId(path.slice('task:'.length));
    if (numericId !== null) {
      return `/w/${workspaceSlug}/tasks?task=${numericId}`;
    }
    return `/w/${workspaceSlug}/tasks`;
  }
  const collection = path.split('/')[0];
  if (collection === 'memory') {
    return `/w/${workspaceSlug}/memory?path=${encodeURIComponent(path)}`;
  }
  const filePath = path.split('/').slice(1).join('/');
  return `/w/${workspaceSlug}/docs?file=${encodeURIComponent(filePath)}`;
}

function truncateSnippet(snippet: string, maxLength = 120): string {
  if (snippet.length <= maxLength) return snippet;
  return `${snippet.slice(0, maxLength).trimEnd()}…`;
}

type SearchResultGroup = RouterOutputs['search']['query'][number];

interface SearchDialogContentProps {
  onClose: () => void;
}

function SearchDialogContent({ onClose }: SearchDialogContentProps) {
  const [inputValue, setInputValue] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const navigate = useVirtualNavigate();

  const workspaceSlug = extractWorkspaceSlug();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  const enabled = !!workspaceSlug && debouncedQuery.length > 0;

  const { data, isFetching, error } = trpc.search.query.useQuery(
    {
      workspaceSlug: workspaceSlug ?? '',
      query: debouncedQuery,
      // Interactive typeahead uses BM25 keyword search (no models, instant).
      // The default 'hybrid' mode cold-loads ~2GB of local GGUF models and runs
      // HyDE query-expansion + LLM reranking on CPU — far too slow for a palette
      // (it would spin "Searching…" indefinitely). Semantic hybrid is reserved
      // for agentic MCP retrieval.
      mode: 'lex',
      limit: 30,
    },
    {
      enabled,
      staleTime: 60_000,
      retry: false,
    },
  );

  const groups: SearchResultGroup[] = data ?? [];

  const sortedGroups = [...groups].sort((a, b) => {
    const ai = COLLECTION_ORDER.indexOf(a.collection);
    const bi = COLLECTION_ORDER.indexOf(b.collection);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  const totalResults = groups.reduce((sum, g) => sum + g.results.length, 0);

  function handleSelect(path: string) {
    if (!workspaceSlug) return;
    onClose();
    const navPath = buildNavigationPath(workspaceSlug, path);
    navigate.push(navPath);
  }

  const showEmpty =
    !isFetching && !error && enabled && data !== undefined && totalResults === 0;
  const showInitialHint = !!workspaceSlug && !enabled && !isFetching;

  return (
    <>
      <CommandInput
        placeholder={workspaceSlug ? 'Search docs, memory, tasks…' : 'Navigate to a workspace to search'}
        value={inputValue}
        onValueChange={setInputValue}
        disabled={!workspaceSlug}
      />
      <CommandList>
        {isFetching && (
          <div className="flex items-center justify-center py-6">
            <span className="text-xs text-muted-foreground">Searching…</span>
          </div>
        )}
        {!isFetching && error && (
          <div className="flex flex-col items-center justify-center gap-1 py-6 px-4">
            <span className="text-xs text-destructive text-center">Search unavailable</span>
            <span className="text-[11px] text-muted-foreground text-center">{error.message}</span>
          </div>
        )}
        {showEmpty && <CommandEmpty>No results found.</CommandEmpty>}
        {showInitialHint && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Type to search across your workspace.
          </div>
        )}
        {!isFetching &&
          !error &&
          sortedGroups.map((group, idx) => {
            const Icon = COLLECTION_ICONS[group.collection];
            const label = COLLECTION_LABELS[group.collection] ?? group.collection;
            return (
              <Fragment key={group.collection}>
                {idx > 0 && <CommandSeparator />}
                <CommandGroup
                  heading={
                    <span className="flex items-center gap-1.5">
                      {label}
                      <span className="text-[10px] tabular-nums text-muted-foreground/70">
                        {group.results.length}
                      </span>
                    </span>
                  }
                >
                  {group.results.map((result) => (
                    <CommandItem
                      key={result.path}
                      value={`${group.collection}:${result.path}:${result.title}`}
                      onSelect={() => handleSelect(result.path)}
                      className="flex items-start gap-2.5"
                    >
                      {Icon && (
                        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate text-foreground">{result.title}</span>
                        {result.snippet && (
                          <span className="line-clamp-1 text-[11px] text-muted-foreground">
                            {truncateSnippet(result.snippet)}
                          </span>
                        )}
                        <MetaPills subtype={result.subtype} tags={result.tags} />
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </Fragment>
            );
          })}
      </CommandList>
      <SearchFooter />
    </>
  );
}

const PILL_CLASS = 'inline-flex h-4 items-center border px-1.5 text-[10px] leading-none';

function MetaPills({ subtype, tags }: { subtype?: string; tags?: string[] }) {
  if (!subtype && (!tags || tags.length === 0)) return null;
  return (
    <div className="mt-0.5 flex flex-wrap items-center gap-1">
      {subtype && (
        <span
          className={cn(
            PILL_CLASS,
            'font-medium',
            SUBTYPE_COLORS[subtype] ?? 'bg-muted text-muted-foreground',
          )}
        >
          {subtype}
        </span>
      )}
      {tags?.map((tag) => (
        <span key={tag} className={cn(PILL_CLASS, 'border-border text-muted-foreground')}>
          {tag}
        </span>
      ))}
    </div>
  );
}

function SearchFooter() {
  return (
    <div className="flex items-center gap-3 border-t px-3 py-1.5 text-[10px] text-muted-foreground">
      <span className="flex items-center gap-1">
        <RiArrowUpDownLine className="size-3" /> Navigate
      </span>
      <span className="flex items-center gap-1">
        <RiCornerDownLeftLine className="size-3" /> Open
      </span>
      <span className="ml-auto">Esc to close</span>
    </div>
  );
}

interface GlobalSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Incremented each time the dialog opens so SearchDialogContent remounts and resets state. */
  sessionKey: number;
}

export function GlobalSearch({ open, onOpenChange, sessionKey }: GlobalSearchProps) {
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Search workspace"
      description="Search docs, memory, tasks, and more"
      shouldFilter={false}
    >
      <SearchDialogContent key={sessionKey} onClose={() => onOpenChange(false)} />
    </CommandDialog>
  );
}
