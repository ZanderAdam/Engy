'use client';

import { RiAddLine } from '@remixicon/react';
import { useTerminalDock } from './terminal-dock-context';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TerminalNewMenuContent } from './terminal-new-menu';

// Empty-state for the terminal dock. Rather than reimplement the open-terminal
// options, it triggers the SAME TerminalNewMenuContent the dock header + button
// uses — one option source, no drift (splits are omitted: no reference panel).
export function TerminalDockWatermark() {
  const { openTerminal, extraDropdownGroups, containerEnabled, defaultScope } = useTerminalDock();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-xs text-muted-foreground">No terminals open</p>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="flex h-8 items-center gap-2 rounded border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
            <RiAddLine className="size-3.5" />
            New Terminal
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="max-h-[70vh] overflow-y-auto">
          <TerminalNewMenuContent
            openTerminal={openTerminal}
            extraDropdownGroups={extraDropdownGroups}
            containerEnabled={containerEnabled}
            defaultScope={defaultScope}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
