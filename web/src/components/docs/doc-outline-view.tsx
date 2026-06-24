'use client';

import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { DocOutlineState } from './doc-outline';

interface DocOutlineProps {
  outline: DocOutlineState | null;
  /** Control rendered in the header (the Files/Outline toggle). */
  headerExtra?: ReactNode;
}

export function DocOutline({ outline, headerExtra }: DocOutlineProps) {
  const headings = outline?.headings ?? [];

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider truncate">
          Outline
        </h3>
        {headerExtra}
      </div>
      {headings.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <p className="text-xs text-muted-foreground text-center">
            No headings in this document
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1 min-h-0 [&>[data-slot=scroll-area-viewport]>div]:!block">
          <div className="p-2">
            {headings.map((h) => (
              <button
                key={h.id}
                type="button"
                onClick={() => outline?.scrollTo(h.id)}
                style={{ paddingLeft: (h.level - 1) * 12 + 8 }}
                className={cn(
                  'flex w-full items-center rounded-sm py-1 pr-2 text-left text-sm',
                  'text-muted-foreground hover:bg-accent hover:text-foreground transition-colors',
                  h.level === 1 && 'font-medium text-foreground',
                )}
                title={h.text}
              >
                <span className="truncate">{h.text}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
