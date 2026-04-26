'use client';

import { RiFileTextLine } from '@remixicon/react';

export function DocDockWatermark() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <RiFileTextLine className="size-10 text-muted-foreground/50" />
      <p className="text-sm text-muted-foreground">Select a file to view</p>
    </div>
  );
}
