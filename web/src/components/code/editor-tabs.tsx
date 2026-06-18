'use client';

import { RiArrowLeftSLine, RiArrowRightSLine, RiCloseLine } from '@remixicon/react';
import { cn } from '@/lib/utils';

interface EditorTabsProps {
  tabs: string[];
  active: string | null;
  canGoBack: boolean;
  canGoForward: boolean;
  onSelect: (path: string) => void;
  onClose: (path: string) => void;
  onBack: () => void;
  onForward: () => void;
}

function basename(path: string): string {
  return path.split('/').pop() || path;
}

export function EditorTabs({
  tabs,
  active,
  canGoBack,
  canGoForward,
  onSelect,
  onClose,
  onBack,
  onForward,
}: EditorTabsProps) {
  return (
    <div className="flex min-h-[34px] items-stretch border-b border-border bg-background">
      <div className="flex shrink-0 items-center border-r border-border">
        <button
          type="button"
          aria-label="Navigate back"
          disabled={!canGoBack}
          onClick={onBack}
          className="flex h-full items-center px-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          <RiArrowLeftSLine className="size-4" />
        </button>
        <button
          type="button"
          aria-label="Navigate forward"
          disabled={!canGoForward}
          onClick={onForward}
          className="flex h-full items-center px-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:hover:text-muted-foreground"
        >
          <RiArrowRightSLine className="size-4" />
        </button>
      </div>

      <div className="flex flex-1 items-stretch overflow-x-auto">
        {tabs.map((path) => {
          const isActive = path === active;
          return (
            <div
              key={path}
              onClick={() => onSelect(path)}
              title={path}
              className={cn(
                'group flex shrink-0 cursor-pointer items-center gap-1.5 border-r border-border px-3 text-xs',
                isActive
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <span className="font-mono">{basename(path)}</span>
              <button
                type="button"
                aria-label={`Close ${basename(path)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(path);
                }}
                className="flex size-4 items-center justify-center rounded-sm text-muted-foreground opacity-0 hover:bg-accent hover:text-foreground group-hover:opacity-100"
              >
                <RiCloseLine className="size-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
