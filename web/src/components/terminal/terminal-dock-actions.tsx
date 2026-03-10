'use client';

import {
  RiAddLine,
  RiArrowRightSLine,
  RiSplitCellsHorizontal,
  RiSplitCellsVertical,
} from '@remixicon/react';
import type { IDockviewHeaderActionsProps } from 'dockview';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useTerminalDock } from './terminal-dock-context';

export function TerminalDockActions({ activePanel }: IDockviewHeaderActionsProps) {
  const { openTerminal, onCollapse } = useTerminalDock();

  return (
    <div className="flex shrink-0 items-center border-l border-border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Add terminal"
            title="New terminal"
          >
            <RiAddLine className="size-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openTerminal()}>
            <RiAddLine className="size-3" />
            New Terminal
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              openTerminal(undefined, { referencePanel: activePanel!.id, direction: 'right' })
            }
            disabled={!activePanel}
          >
            <RiSplitCellsHorizontal className="size-3" />
            Split Right
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              openTerminal(undefined, { referencePanel: activePanel!.id, direction: 'below' })
            }
            disabled={!activePanel}
          >
            <RiSplitCellsVertical className="size-3" />
            Split Down
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        onClick={onCollapse}
        className="flex h-8 w-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground border-l border-border"
        aria-label="Collapse terminal panel"
        title="Collapse (Ctrl+`)"
      >
        <RiArrowRightSLine className="size-3" />
      </button>
    </div>
  );
}
