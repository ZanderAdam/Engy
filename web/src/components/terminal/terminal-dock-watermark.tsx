'use client';

import { RiTerminalLine } from '@remixicon/react';
import { useTerminalDock } from './terminal-dock-context';

export function TerminalDockWatermark() {
  const { openTerminal } = useTerminalDock();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-xs text-muted-foreground">No terminals open</p>
      <button
        onClick={() => openTerminal()}
        className="flex items-center gap-1.5 border border-border px-3 py-1.5 text-xs text-foreground hover:bg-muted"
      >
        <RiTerminalLine className="size-3" />
        Open Terminal
      </button>
    </div>
  );
}
