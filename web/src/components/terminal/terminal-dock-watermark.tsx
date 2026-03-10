'use client';

import { RiTerminalLine } from '@remixicon/react';
import { Button } from '@/components/ui/button';
import { useTerminalDock } from './terminal-dock-context';

export function TerminalDockWatermark() {
  const { openTerminal } = useTerminalDock();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3">
      <p className="text-xs text-muted-foreground">No terminals open</p>
      <Button variant="outline" size="sm" onClick={() => openTerminal()}>
        <RiTerminalLine className="size-3" />
        Open Terminal
      </Button>
    </div>
  );
}
