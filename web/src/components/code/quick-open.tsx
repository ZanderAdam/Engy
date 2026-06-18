'use client';

import { useEffect, useState } from 'react';
import { RiFileLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { toRelPath } from './repo-file-tree-helpers';

interface QuickOpenProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Worktree-effective root the search runs against. */
  rootDir: string;
  /** Receives the file path relative to rootDir. */
  onSelectFile: (relPath: string) => void;
}

function splitPath(relPath: string): { name: string; dir: string } {
  const idx = relPath.lastIndexOf('/');
  if (idx === -1) return { name: relPath, dir: '' };
  return { name: relPath.slice(idx + 1), dir: relPath.slice(0, idx) };
}

export function QuickOpen({ open, onOpenChange, rootDir, onSelectFile }: QuickOpenProps) {
  const utils = trpc.useUtils();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<string[]>([]);

  // Clearing on close (rather than in an open-effect) leaves the next open empty
  // without a synchronous setState inside an effect.
  const handleOpenChange = (next: boolean) => {
    if (!next) setQuery('');
    onOpenChange(next);
  };

  // Debounced server-side fuzzy file search. Results are already ranked, so the
  // cmdk root runs with shouldFilter=false to avoid a second, conflicting filter.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await utils.dir.searchRepoFiles.fetch({
          dirs: [rootDir],
          query: query.trim(),
          limit: 50,
        });
        if (!cancelled) setResults(res.results.map((r) => toRelPath(r.path, rootDir)));
      } catch {
        if (!cancelled) setResults([]);
      }
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, open, rootDir, utils]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      shouldFilter={false}
      title="Go to File"
      description="Search files by name"
    >
      <CommandInput
        placeholder="Go to file..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No files found.</CommandEmpty>
        {results.map((rel) => {
          const { name, dir } = splitPath(rel);
          return (
            <CommandItem
              key={rel}
              value={rel}
              onSelect={() => {
                onSelectFile(rel);
                handleOpenChange(false);
              }}
              className="gap-2"
            >
              <RiFileLine className="size-4 shrink-0 text-muted-foreground" />
              <span className="font-mono text-xs">{name}</span>
              {dir && <span className="truncate font-mono text-[10px] text-muted-foreground">{dir}</span>}
            </CommandItem>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}
