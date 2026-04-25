'use client';

import { useState } from 'react';
import { useVirtualParams } from '@/components/tabs/tab-context';
import { RiFileCopyLine, RiCheckLine } from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface CopyTaskSlugProps {
  taskId: number;
}

export function CopyTaskSlug({ taskId }: CopyTaskSlugProps) {
  const params = useVirtualParams<{ workspace: string }>();
  const workspaceSlug = params.workspace ?? '';
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
            className="inline-flex h-6 shrink-0 cursor-pointer items-center gap-0.5 rounded border border-border px-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            T-{taskId}
            {copied ? (
              <RiCheckLine className="size-3 text-green-500" />
            ) : (
              <RiFileCopyLine className="size-3" />
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
