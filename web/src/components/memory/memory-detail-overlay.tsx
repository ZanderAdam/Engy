'use client';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { RiCloseLine } from '@remixicon/react';
import { MemoryDetail } from './memory-detail';
import type { MemorySelection } from './types';

interface MemoryDetailOverlayProps {
  selection: MemorySelection;
  workspaceSlug: string;
  repos: string[];
  onClose: () => void;
}

// Docked to the center pane's right edge over the graph; PermanentDetail /
// FleetingDetail already own their in-flow headers, so the close control gets
// its own strip above them rather than overlapping either.
export function MemoryDetailOverlay({
  selection,
  workspaceSlug,
  repos,
  onClose,
}: MemoryDetailOverlayProps) {
  return (
    <TooltipProvider>
      <div className="absolute inset-y-0 right-0 z-20 w-[400px] max-w-full border-l border-border bg-background flex flex-col">
        <div className="flex items-center justify-end px-2 py-1.5 border-b border-border shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                className="text-muted-foreground"
              >
                <RiCloseLine className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">Close</TooltipContent>
          </Tooltip>
        </div>
        <div className="flex-1 min-h-0">
          <MemoryDetail
            selection={selection}
            workspaceSlug={workspaceSlug}
            repos={repos}
            onDeleted={onClose}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}
