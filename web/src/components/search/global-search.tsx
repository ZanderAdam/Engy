'use client';

import { Fragment, useEffect, useState, type ComponentType, type KeyboardEvent } from 'react';
import { parseTaskId } from './task-id';
import {
  SEARCH_MODES,
  activeQueryForMode,
  isLiveMode,
  needsManualSubmit,
  searchModeMeta,
  type SearchMode,
} from './search-mode';
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
  const [mode, setMode] = useState<SearchMode>('lex');
  // Hybrid runs local LLM inference (query expansion + rerank) that can take
  // minutes on CPU — far too slow to fire on every keystroke. Live modes (lex,
  // vector) query the debounced input; hybrid queries only this submitted value.
  const [submittedQuery, setSubmittedQuery] = useState('');
  const navigate = useVirtualNavigate();

  const workspaceSlug = extractWorkspaceSlug();

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(inputValue.trim());
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [inputValue]);

  // An empty input means "nothing queried" in every mode — clamp to '' so a
  // lingering submittedQuery (e.g. after clearing the box post-hybrid) can't
  // keep the query enabled and render stale results under the initial hint.
  const hasInput = inputValue.trim().length > 0;
  const activeQuery = hasInput ? activeQueryForMode(mode, debouncedQuery, submittedQuery) : '';
  const enabled = !!workspaceSlug && activeQuery.length > 0;
  const manualPending = needsManualSubmit(mode, inputValue, submittedQuery);

  function handleModeChange(next: SearchMode) {
    setMode(next);
    // A pending hybrid submission is meaningless in a live mode and vice versa.
    setSubmittedQuery('');
  }

  function handleInputKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // In a manual mode, Enter submits the search instead of selecting a result.
    // Stop propagation so cmdk doesn't also act on the same keypress.
    if (e.key === 'Enter' && manualPending) {
      e.preventDefault();
      e.stopPropagation();
      setSubmittedQuery(inputValue.trim());
    }
  }

  const { data, isFetching, error } = trpc.search.query.useQuery(
    {
      workspaceSlug: workspaceSlug ?? '',
      query: activeQuery,
      mode,
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
  const showInitialHint = !!workspaceSlug && !hasInput && !isFetching && !error;

  return (
    <>
      <CommandInput
        placeholder={workspaceSlug ? 'Search docs, memory, tasks…' : 'Navigate to a workspace to search'}
        value={inputValue}
        onValueChange={setInputValue}
        onKeyDown={handleInputKeyDown}
        disabled={!workspaceSlug}
      />
      <SearchModeToggle
        mode={mode}
        onModeChange={handleModeChange}
        manualPending={manualPending}
        disabled={!workspaceSlug}
      />
      <CommandList>
        {isFetching && (
          <div className="flex items-center justify-center gap-3 py-6">
            <span className="text-xs text-muted-foreground">Searching…</span>
            {!isLiveMode(mode) && (
              <button
                type="button"
                onClick={() => setSubmittedQuery('')}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Cancel
              </button>
            )}
          </div>
        )}
        {!isFetching && !error && manualPending && (
          <div className="py-8 text-center text-xs text-muted-foreground">
            Press <kbd className="rounded border px-1">Enter</kbd> to run a hybrid search.
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
          !manualPending &&
          enabled &&
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

interface SearchModeToggleProps {
  mode: SearchMode;
  onModeChange: (mode: SearchMode) => void;
  manualPending: boolean;
  disabled: boolean;
}

function SearchModeToggle({ mode, onModeChange, manualPending, disabled }: SearchModeToggleProps) {
  const hint = manualPending ? 'Enter to search' : searchModeMeta(mode).hint;
  return (
    <div className="flex items-center gap-2 border-b px-2 py-1">
      <div className="flex items-center gap-0.5">
        {SEARCH_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            disabled={disabled}
            onClick={() => onModeChange(m.mode)}
            aria-pressed={m.mode === mode}
            className={cn(
              'h-5 border px-1.5 text-[10px] leading-none disabled:opacity-50',
              m.mode === mode
                ? 'border-border bg-muted text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <span className="ml-auto truncate text-[10px] text-muted-foreground/70">{hint}</span>
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
