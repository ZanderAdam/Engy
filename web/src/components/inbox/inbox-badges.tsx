import { RISK_PRESENTATION } from '@/lib/review-summary-meta';
import { ciStatusClassName, ciStatusLabel } from '@/components/prs/pr-helpers';
import { cn } from '@/lib/utils';
import type { GhPrCiStatus } from '@engy/common';
import type { InboxItem } from './inbox-helpers';

const BADGE_CLASS = 'shrink-0 border px-1.5 py-px text-[10px] font-medium';

export function InboxRiskBadge({ risk }: { risk: InboxItem['risk'] }) {
  if (!risk) return null;
  const { label, className } = RISK_PRESENTATION[risk.level];
  return (
    <span title={risk.reason} className={cn(BADGE_CLASS, className)}>
      {label}
    </span>
  );
}

export function InboxCiBadge({ ci }: { ci: GhPrCiStatus | undefined }) {
  if (!ci) return null;
  return (
    <span className={cn(BADGE_CLASS, ciStatusClassName(ci))}>
      CI {ciStatusLabel(ci).toLowerCase()}
    </span>
  );
}
