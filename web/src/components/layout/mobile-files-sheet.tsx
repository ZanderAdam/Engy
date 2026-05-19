'use client';

import { RiArrowLeftSLine } from '@remixicon/react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { useMobileOverlay } from './mobile-overlay-context';

interface MobileFilesSheetProps {
  title?: string;
  children: React.ReactNode;
}

export function MobileFilesSheet({ title = 'FILES', children }: MobileFilesSheetProps) {
  const { overlay, closeOverlay } = useMobileOverlay();
  const open = overlay === 'files';

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) closeOverlay();
      }}
    >
      <SheetContent
        side="left"
        className="flex h-full w-full flex-col gap-0 border-r border-border bg-background p-0"
        showCloseButton={false}
      >
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={closeOverlay}
            aria-label="Close files"
          >
            <RiArrowLeftSLine className="size-4" />
          </Button>
          <SheetTitle className="text-xs tracking-widest text-muted-foreground">
            {title}
          </SheetTitle>
          <div className="size-8" aria-hidden />
        </div>
        <div className="flex-1 overflow-auto">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
