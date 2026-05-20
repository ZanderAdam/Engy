'use client';

import { useEffect, useRef } from 'react';
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

const QUEUED_EVENT_NAMES = ['terminal:open', 'terminal:inject'] as const;

export function MobileTerminalSheet({
  extraDropdownGroups,
  containerEnabled,
}: MobileTerminalSheetProps) {
  const { overlay, openOverlay, closeOverlay } = useMobileOverlay();
  const scope = useBottomTerminalScope();
  const scopeKey = scope.groupKey;
  const open = overlay === 'terminal';

  // Queue terminal:open / terminal:inject events fired while the sheet is
  // closed (TerminalManager unmounted, so no listener exists) and replay
  // them once the sheet — and its TerminalManager — has mounted.
  const pendingRef = useRef<Array<{ name: string; detail: unknown }>>([]);
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  useEffect(() => {
    function makeHandler(name: string) {
      return (e: Event) => {
        if (openRef.current) return;
        const detail = (e as CustomEvent).detail;
        pendingRef.current.push({ name, detail });
        openOverlay('terminal');
      };
    }
    const handlers = QUEUED_EVENT_NAMES.map((name) => {
      const h = makeHandler(name);
      window.addEventListener(name, h);
      return [name, h] as const;
    });
    return () => {
      for (const [name, h] of handlers) window.removeEventListener(name, h);
    };
  }, [openOverlay]);

  useEffect(() => {
    if (!open || pendingRef.current.length === 0) return;
    const queued = pendingRef.current;
    pendingRef.current = [];
    // Defer until after TerminalManager mounts and its window listeners attach.
    const id = setTimeout(() => {
      for (const { name, detail } of queued) {
        window.dispatchEvent(new CustomEvent(name, { detail }));
      }
    }, 0);
    return () => clearTimeout(id);
  }, [open]);

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
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
