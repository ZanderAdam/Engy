'use client';

import { useEffect, useState } from 'react';
import { trpc } from '@/lib/trpc';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Badge } from '@/components/ui/badge';
import { useVirtualNavigate } from '@/components/tabs/tab-context';

const DEBOUNCE_MS = 300;

const COLLECTION_LABELS: Record<string, string> = {
  system: 'System',
  docs: 'Docs',
  projects: 'Projects',
  memory: 'Memory',
  tasks: 'Tasks',
};

const COLLECTION_ORDER = ['tasks', 'projects', 'docs', 'memory', 'system'];

function extractWorkspaceSlug(): string | null {
  if (typeof window === 'undefined') return null;
  const match = /^\/w\/([^/?#]+)/.exec(window.location.pathname);
  return match ? match[1] : null;
}

function buildNavigationPath(workspaceSlug: string, path: string): string {
  if (path.startsWith('task:')) {
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

interface SearchResultGroup {
  collection: string;
  results: Array<{
    path: string;
    title: string;
    snippet?: string;
    score?: number;
  }>;
}

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

  const { data, isFetching } = trpc.search.query.useQuery(
    {
      workspaceSlug: workspaceSlug ?? '',
      query: debouncedQuery,
      limit: 30,
    },
    {
      enabled,
      staleTime: 60_000,
      retry: false,
    },
  );

  const groups: SearchResultGroup[] = (data as SearchResultGroup[] | undefined) ?? [];

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

  const showEmpty = !isFetching && enabled && totalResults === 0;

  return (
    <>
      <CommandInput
        placeholder={workspaceSlug ? 'Search workspace…' : 'Navigate to a workspace to search'}
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
        {showEmpty && <CommandEmpty>No results found.</CommandEmpty>}
        {!workspaceSlug && !isFetching && (
          <div className="py-6 text-center text-xs text-muted-foreground">
            Open a workspace to start searching.
          </div>
        )}
        {!isFetching &&
          sortedGroups.map((group, idx) => (
            <span key={group.collection}>
              {idx > 0 && <CommandSeparator />}
              <CommandGroup heading={COLLECTION_LABELS[group.collection] ?? group.collection}>
                {group.results.map((result) => (
                  <CommandItem
                    key={result.path}
                    value={`${group.collection}:${result.path}:${result.title}`}
                    onSelect={() => handleSelect(result.path)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <div className="flex w-full items-center gap-2">
                      <span className="flex-1 truncate">{result.title}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {COLLECTION_LABELS[group.collection] ?? group.collection}
                      </Badge>
                    </div>
                    {result.snippet && (
                      <span className="line-clamp-1 text-[11px] text-muted-foreground">
                        {truncateSnippet(result.snippet)}
                      </span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            </span>
          ))}
      </CommandList>
    </>
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
    >
      <SearchDialogContent key={sessionKey} onClose={() => onOpenChange(false)} />
    </CommandDialog>
  );
}
