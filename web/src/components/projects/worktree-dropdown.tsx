'use client';

import { useState } from 'react';
import { RiArrowDownSLine, RiGitBranchLine, RiSettings3Line } from '@remixicon/react';
import {
  useVirtualNavigate,
  useVirtualPathname,
  useVirtualSearchParams,
} from '@/components/tabs/tab-context';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useProjectWorktreeMap } from '@/hooks/use-project-worktree-map';
import { trpc } from '@/lib/trpc';

interface WorktreeDropdownProps {
  projectId: number;
  workspaceRepoCount: number;
  onOpenManage: () => void;
  hideManageButton?: boolean;
}

export function WorktreeDropdown({
  projectId,
  workspaceRepoCount,
  onOpenManage,
  hideManageButton = false,
}: WorktreeDropdownProps) {
  const [open, setOpen] = useState(false);
  const pathname = useVirtualPathname();
  const searchParams = useVirtualSearchParams();
  const navigate = useVirtualNavigate();

  const { branch, allGroups } = useProjectWorktreeMap({ projectId });
  const { data: listGroupedData } = trpc.worktree.listGrouped.useQuery({ projectId });
  const listErrors = listGroupedData?.errors ?? [];

  const triggerLabel = branch ?? 'default';

  function setWorktree(nextBranch: string | null) {
    const next = new URLSearchParams(searchParams);
    if (nextBranch === null) next.delete('wt');
    else next.set('wt', nextBranch);
    const qs = next.toString();
    navigate.push(qs ? `${pathname}?${qs}` : pathname);
    setOpen(false);
  }

  // allGroups is already sorted server-side (worktree.listGrouped).
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Select worktree"
            title={triggerLabel}
            className="flex min-w-0 max-w-[7rem] sm:max-w-[10rem] items-center gap-1 rounded-sm border border-input/40 bg-input/30 px-2 py-0.5 text-xs hover:bg-muted"
          >
            <RiGitBranchLine className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono">{triggerLabel}</span>
            <RiArrowDownSLine className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search branches..." />
            <CommandList>
              <CommandEmpty>No worktrees.</CommandEmpty>
              <CommandGroup>
                <CommandItem
                  value="default"
                  data-checked={!branch}
                  onSelect={() => setWorktree(null)}
                >
                  <RiGitBranchLine className="mr-2 size-3" />
                  <span className="flex-1">default branch</span>
                </CommandItem>
                {allGroups.map((g) => (
                  <CommandItem
                    key={g.branch}
                    value={g.branch}
                    data-checked={branch === g.branch}
                    onSelect={() => setWorktree(g.branch)}
                  >
                    <RiGitBranchLine className="mr-2 size-3" />
                    <span className="flex-1 font-mono">{g.branch}</span>
                    <span
                      className={cn(
                        'ml-2 text-[10px] tabular-nums',
                        g.repos.length === workspaceRepoCount
                          ? 'text-muted-foreground'
                          : 'text-amber-500',
                      )}
                    >
                      {g.repos.length}/{workspaceRepoCount}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {listErrors.length > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                aria-label="Some repos failed to list worktrees"
                className="cursor-default text-xs text-amber-500"
              >
                ⚠
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="mb-1 font-medium">Failed to list worktrees in:</p>
              <ul className="space-y-0.5">
                {listErrors.map(({ repoPath, message }) => (
                  <li key={repoPath} className="font-mono text-[11px]">
                    {repoPath}: {message}
                  </li>
                ))}
              </ul>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {!hideManageButton && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label="Manage worktrees"
                onClick={onOpenManage}
                className="flex items-center justify-center rounded-sm border border-input/40 bg-input/30 p-1 hover:bg-muted"
              >
                <RiSettings3Line className="size-3 text-muted-foreground" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Manage worktrees</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
