'use client';

import {
  RiAddLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiCloseLine,
  RiGitBranchLine,
} from '@remixicon/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTabsList } from './tab-context';
import { deriveTabTitle } from './tab-state';
import { cn } from '@/lib/utils';

interface OpenTabsPickerProps {
  children: React.ReactNode;
  /**
   * `start` pins the menu to the viewport's left edge, which the mobile
   * identity bar relies on to get a full-width list; `end` anchors it under
   * the trigger for the desktop tab strip's right-hand button.
   */
  align?: 'start' | 'end';
}

export function OpenTabsPicker({ children, align = 'start' }: OpenTabsPickerProps) {
  const ctx = useTabsList();
  if (!ctx) {
    return <>{children}</>;
  }
  const { tabs, activeTabId, activateTab, closeTab, closeAllTabs, openNewTab } = ctx;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={4}
        alignOffset={align === 'start' ? -9999 : 0}
        collisionPadding={8}
        className="md:min-w-[16rem] md:w-auto md:max-w-none w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)]"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          const { segments, worktree } = deriveTabTitle(tab.virtualPath);
          return (
            <DropdownMenuItem
              key={tab.id}
              onSelect={() => activateTab(tab.id)}
              className={cn('flex flex-col items-start gap-0.5', isActive && 'font-medium')}
              aria-current={isActive || undefined}
            >
              <div className="flex w-full items-center gap-2">
                <RiCheckLine
                  className={cn('size-3 shrink-0', isActive ? 'opacity-100' : 'opacity-0')}
                  aria-hidden={!isActive}
                />
                <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
                  {segments.map((seg, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <span className="opacity-60">›</span>}
                      <span
                        className={cn(
                          'truncate',
                          i === segments.length - 1 ? 'font-semibold' : 'text-muted-foreground',
                        )}
                      >
                        {seg}
                      </span>
                    </span>
                  ))}
                </span>
                <button
                  type="button"
                  aria-label={`Close ${tab.title}`}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    closeTab(tab.id);
                  }}
                  className="flex size-4 shrink-0 items-center justify-center opacity-60 hover:bg-muted hover:opacity-100"
                >
                  <RiCloseLine className="size-3" />
                </button>
              </div>
              {worktree && (
                <span className="flex w-full min-w-0 items-center gap-0.5 font-mono text-[10px] text-muted-foreground">
                  <RiGitBranchLine className="size-2.5 shrink-0" />
                  <span className="truncate">{worktree}</span>
                </span>
              )}
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openNewTab('/')}>
          <RiAddLine className="size-3" />
          <span>New tab</span>
        </DropdownMenuItem>
        <DropdownMenuItem disabled={tabs.length <= 1} onSelect={closeAllTabs}>
          <RiCloseCircleLine className="size-3" />
          <span>Close all tabs</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
