'use client';

import { useState } from 'react';
import { RiFileCopyLine, RiCheckLine } from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CopyTaskSlugProps {
  taskId: number;
  workspaceSlug: string;
}

export function CopyTaskSlug({ taskId, workspaceSlug }: CopyTaskSlugProps) {
  const [copied, setCopied] = useState(false);
  const fullSlug = `${workspaceSlug}-T${taskId}`;

  function copySlug() {
    navigator.clipboard.writeText(fullSlug).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }, () => {});
  }

  function handleClick(e: React.SyntheticEvent) {
    e.stopPropagation();
    copySlug();
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="button"
            tabIndex={0}
            onClick={handleClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') handleClick(e);
            }}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            T-{taskId}
            {copied ? (
              <RiCheckLine className="size-3 text-green-500" />
            ) : (
              <RiFileCopyLine className="size-3 opacity-0 group-hover/task:opacity-100" />
            )}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {copied ? 'Copied!' : fullSlug}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
