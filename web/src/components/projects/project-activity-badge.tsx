'use client';

import { cn } from '@/lib/utils';
import { useProjectActivity } from '@/hooks/use-project-activity';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ProjectActivityBadgeProps {
  projectSlug?: string;
  className?: string;
}

function Digit({ n, activeColor }: { n: number; activeColor: string }) {
  return <span className={n > 0 ? activeColor : 'text-muted-foreground/40'}>{n}</span>;
}

// Color-coded terminal-activity counts for a project, reusing the rail's
// colors: amber = waiting (needs input), blue = busy, emerald = done (finished
// but unacknowledged). All three counts always render (zeros dimmed) so the
// badge keeps a stable width while counts change.
export function ProjectActivityBadge({ projectSlug, className }: ProjectActivityBadgeProps) {
  const { active, waiting, done } = useProjectActivity(projectSlug);

  const title =
    [
      waiting > 0 && `${waiting} waiting`,
      active > 0 && `${active} busy`,
      done > 0 && `${done} done`,
    ]
      .filter(Boolean)
      .join(' · ') || 'idle';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 font-mono text-[10px] tabular-nums',
              className,
            )}
            aria-label={`Terminal activity: ${title}`}
          >
            <Digit n={waiting} activeColor="text-amber-400" />
            <Digit n={active} activeColor="text-blue-500" />
            <Digit n={done} activeColor="text-emerald-400" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">{title}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
