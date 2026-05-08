'use client';

import { useState } from 'react';
import { RiArrowDownSLine } from '@remixicon/react';
import { trpc } from '@/lib/trpc';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { TaggedWorktreeEntry } from '@/server/trpc/routers/diff';

export type WorktreeSelection = { worktreePath: string; coderWorkspace?: string } | null;

interface WorktreeSelectorProps {
  workspaceSlug: string;
  repoDir: string;
  value: WorktreeSelection;
  onChange: (value: WorktreeSelection) => void;
}

const MAIN_VALUE = '__main__';

function entryLabel(entry: TaggedWorktreeEntry): string {
  return entry.branch ?? entry.path.split('/').filter(Boolean).pop() ?? entry.path;
}

function entryKey(entry: TaggedWorktreeEntry): string {
  const coder = entry.location !== 'local' ? entry.location.coderWorkspace : '';
  return `${coder}:${entry.path}`;
}

function selectionKey(selection: WorktreeSelection): string {
  if (!selection) return MAIN_VALUE;
  return `${selection.coderWorkspace ?? ''}:${selection.worktreePath}`;
}

export function WorktreeSelector({
  workspaceSlug,
  repoDir,
  value,
  onChange,
}: WorktreeSelectorProps) {
  const [open, setOpen] = useState(false);
  const { data: worktrees = [] } = trpc.diff.getWorktrees.useQuery(
    { workspaceSlug, repoDir },
    { enabled: !!repoDir },
  );

  const localEntries = worktrees.filter((wt) => wt.location === 'local' && !wt.isMain);
  const coderEntries = worktrees.filter((wt) => wt.location !== 'local');
  const coderWorkspaceNames = [
    ...new Set(
      coderEntries.map((wt) => (wt.location as { coderWorkspace: string }).coderWorkspace),
    ),
  ];

  const selectedKey = selectionKey(value);
  const selectedEntry = value ? worktrees.find((wt) => entryKey(wt) === selectedKey) : null;
  const selectedLabel = selectedEntry ? entryLabel(selectedEntry) : 'Main repo';

  const select = (next: WorktreeSelection) => {
    onChange(next);
    setOpen(false);
  };

  return (
    <div className="border-b border-border px-3 py-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-none border border-input/30 bg-input/30 px-2 py-1.5 text-xs hover:bg-muted"
          >
            <span className="truncate">{selectedLabel}</span>
            <RiArrowDownSLine className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder="Search worktrees..." />
            <CommandList className="max-h-72">
              <CommandEmpty>No worktrees found.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="Main repo"
                  data-checked={!value}
                  onSelect={() => select(null)}
                >
                  Main repo
                </CommandItem>
                {localEntries.map((wt) => {
                  const key = entryKey(wt);
                  return (
                    <CommandItem
                      key={key}
                      value={entryLabel(wt)}
                      data-checked={selectedKey === key}
                      onSelect={() => select({ worktreePath: wt.path })}
                    >
                      {entryLabel(wt)}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              {coderWorkspaceNames.map((ws) => (
                <CommandGroup key={ws} heading={`Coder: ${ws}`}>
                  {coderEntries
                    .filter(
                      (wt) =>
                        (wt.location as { coderWorkspace: string }).coderWorkspace === ws,
                    )
                    .map((wt) => {
                      const key = entryKey(wt);
                      return (
                        <CommandItem
                          key={key}
                          value={`${entryLabel(wt)} ${ws}`}
                          data-checked={selectedKey === key}
                          onSelect={() =>
                            select({ worktreePath: wt.path, coderWorkspace: ws })
                          }
                        >
                          {entryLabel(wt)}
                        </CommandItem>
                      );
                    })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
