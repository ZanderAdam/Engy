'use client';

import { RiArrowRightSLine } from '@remixicon/react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useBottomTerminalScope } from '@/components/terminal/use-terminal-scope';
import { TerminalManager } from '@/components/terminal/terminal-manager';
import type { TerminalDropdownGroup } from '@/components/terminal/types';
import { useMobileOverlay } from './mobile-overlay-context';

interface MobileTerminalSheetProps {
  extraDropdownGroups?: TerminalDropdownGroup[];
  containerEnabled?: boolean;
}

export function MobileTerminalSheet({
  extraDropdownGroups,
  containerEnabled,
}: MobileTerminalSheetProps) {
  const { overlay, closeOverlay } = useMobileOverlay();
  const scope = useBottomTerminalScope();
  const scopeKey = scope.groupKey;
  const open = overlay === 'terminal';

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) closeOverlay();
      }}
    >
      <SheetContent
        side="right"
        className="flex h-full w-full flex-col gap-0 border-l border-border bg-background p-0"
        showCloseButton={false}
      >
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={closeOverlay}
            aria-label="Close terminal"
          >
            <RiArrowRightSLine className="size-4" />
          </Button>
          <SheetTitle className="text-xs text-muted-foreground">Terminal</SheetTitle>
          <div className="size-8" aria-hidden />
        </div>
        <div className="flex flex-1 min-h-0 bg-[#0a0a0a]">
          {open && (
            <TerminalManager
              key={scopeKey}
              onCollapse={closeOverlay}
              defaultScope={scope}
              extraDropdownGroups={extraDropdownGroups}
              containerEnabled={containerEnabled}
              disableExternalEvents
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
