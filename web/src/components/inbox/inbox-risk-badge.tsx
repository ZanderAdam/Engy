import { RISK_PRESENTATION } from '@/components/diff/review-summary-meta';
import { cn } from '@/lib/utils';
import type { InboxItem } from './inbox-helpers';

export function InboxRiskBadge({ risk }: { risk: InboxItem['risk'] }) {
  if (!risk) return null;
  const { label, className } = RISK_PRESENTATION[risk.level];
  return (
    <span
      title={risk.reason}
      className={cn('shrink-0 border px-1.5 py-px text-[10px] font-medium', className)}
    >
      {label}
    </span>
  );
}
