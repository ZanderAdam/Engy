/* eslint-disable react-hooks/set-state-in-effect */
'use client';

import path from 'path';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RiFolderLine, RiLoader4Line, RiArrowUpLine } from '@remixicon/react';

interface OpenDirDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Split input into the parent dir to list and a filter for the last segment.
// "/Users/aleks/de"  → { browsePath: "/Users/aleks", filter: "de" }
// "/Users/aleks/"    → { browsePath: "/Users/aleks", filter: "" }
function parseBrowsePath(input: string): { browsePath: string; filter: string } {
  if (!input) return { browsePath: '', filter: '' };
  if (input.endsWith('/')) {
    return { browsePath: input.slice(0, -1) || '/', filter: '' };
  }
  return { browsePath: path.dirname(input), filter: path.basename(input) };
}

export function OpenDirDialog({ open, onOpenChange }: OpenDirDialogProps) {
  const router = useRouter();
  const [inputValue, setInputValue] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: homeData } = trpc.dir.home.useQuery(undefined, { enabled: open });
  const { browsePath, filter } = parseBrowsePath(inputValue);

  const { data, isLoading } = trpc.dir.listDirs.useQuery(
    { dirPath: browsePath },
    { enabled: !!browsePath && open },
  );

  const seededRef = useRef(false);

  useEffect(() => {
    if (!open) {
      setInputValue('');
      setSelectedIndex(-1);
      seededRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (open && homeData && !seededRef.current) {
      seededRef.current = true;
      setInputValue(homeData.path + '/');
    }
  }, [open, homeData]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [browsePath]);

  const dirs = data?.dirs ?? [];
  const filteredDirs = filter
    ? dirs.filter((d) => d.toLowerCase().includes(filter.toLowerCase()))
    : dirs;

  // Scroll selected item into view.
  useEffect(() => {
    if (selectedIndex >= 0 && listRef.current) {
      listRef.current
        .querySelector<HTMLElement>(`[data-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  function navigateTo(dir: string) {
    setSelectedIndex(-1);
    setInputValue(path.join(browsePath, dir) + '/');
  }

  function goUp() {
    const parent = path.dirname(browsePath);
    if (parent !== browsePath) {
      setSelectedIndex(-1);
      setInputValue(parent + '/');
    }
  }

  function handleInputChange(value: string) {
    setSelectedIndex(-1);
    // On '/' typed: autocomplete current filter if exact or single match exists.
    if (value.endsWith('/') && !inputValue.endsWith('/') && filter) {
      const exact = filteredDirs.find((d) => d.toLowerCase() === filter.toLowerCase());
      const match = exact ?? (filteredDirs.length === 1 ? filteredDirs[0] : null);
      if (match) {
        setInputValue(path.join(browsePath, match) + '/');
        return;
      }
    }
    setInputValue(value);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => (filteredDirs.length > 0 ? Math.min(i + 1, filteredDirs.length - 1) : -1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const target = filteredDirs[selectedIndex >= 0 ? selectedIndex : 0];
      if (target) navigateTo(target);
    } else if (e.key === 'Enter') {
      if (selectedIndex >= 0 && filteredDirs[selectedIndex]) {
        navigateTo(filteredDirs[selectedIndex]);
      } else {
        handleOpen();
      }
    }
  }

  const canGoUp = !!browsePath && path.dirname(browsePath) !== browsePath;
  const openPath =
    inputValue.endsWith('/') && inputValue !== '/' ? inputValue.slice(0, -1) : inputValue;

  function handleOpen() {
    if (!openPath) return;
    onOpenChange(false);
    router.push(`/open?path=${encodeURIComponent(openPath)}`);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-3 p-4 sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Open Directory</DialogTitle>
        </DialogHeader>

        <Input
          value={inputValue}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="/Users/you/docs"
          className="font-mono text-xs"
          autoFocus
        />

        <div className="overflow-hidden rounded border border-border">
          <div ref={listRef} className="max-h-56 overflow-y-auto">
            {canGoUp && (
              <button
                type="button"
                className="flex w-full items-center gap-2 border-b border-border px-3 py-1.5 text-left text-xs hover:bg-accent/50"
                onClick={goUp}
              >
                <RiArrowUpLine className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="text-muted-foreground">..</span>
              </button>
            )}
            {isLoading && (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <RiLoader4Line className="size-3 animate-spin" /> Loading…
              </div>
            )}
            {!isLoading && !!browsePath && filteredDirs.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground">No matches</p>
            )}
            {filteredDirs.map((dir, index) => (
              <button
                key={dir}
                data-index={index}
                type="button"
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors',
                  index === selectedIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50',
                )}
                onClick={() => navigateTo(dir)}
              >
                <RiFolderLine className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{dir}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" disabled={!openPath} onClick={handleOpen}>
            Open
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
