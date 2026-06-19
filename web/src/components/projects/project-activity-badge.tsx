'use client';

import { cn } from '@/lib/utils';
import { useProjectActivity } from '@/hooks/use-project-activity';

interface ProjectActivityBadgeProps {
  projectSlug?: string;
  className?: string;
}

// Color-coded terminal-activity counts for a project, reusing the rail's
// colors: amber = waiting (needs input), blue = busy, emerald = done (finished
// but unacknowledged). Idle counts are omitted; renders nothing when all zero.
export function ProjectActivityBadge({ projectSlug, className }: ProjectActivityBadgeProps) {
  const { active, waiting, done } = useProjectActivity(projectSlug);

  if (!waiting && !active && !done) return null;

  const title = [
    waiting && `${waiting} waiting`,
    active && `${active} busy`,
    done && `${done} done`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <span
      className={cn('inline-flex items-center gap-1 font-mono text-[10px] tabular-nums', className)}
      title={title}
      aria-label={`Terminal activity: ${title}`}
    >
      {waiting > 0 && <span className="text-amber-400">{waiting}</span>}
      {active > 0 && <span className="text-blue-500">{active}</span>}
      {done > 0 && <span className="text-emerald-400">{done}</span>}
    </span>
  );
}
