import { ciStatusClassName, ciStatusLabel } from '@/components/prs/pr-helpers';
import { cn } from '@/lib/utils';
import type { GhPrCiStatus } from '@engy/common';

const BADGE_CLASS = 'shrink-0 border px-1.5 py-px text-[10px] font-medium';

export function InboxCiBadge({ ci }: { ci: GhPrCiStatus | undefined }) {
  if (!ci) return null;
  return (
    <span className={cn(BADGE_CLASS, ciStatusClassName(ci))}>
      CI {ciStatusLabel(ci).toLowerCase()}
    </span>
  );
}
