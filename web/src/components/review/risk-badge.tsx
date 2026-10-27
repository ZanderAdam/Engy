import { RISK_PRESENTATION, type ReviewRisk } from '@/lib/review-summary-meta';
import { cn } from '@/lib/utils';

interface RiskBadgeProps {
  risk: ReviewRisk | null | undefined;
  short?: boolean;
  className?: string;
}

export function RiskBadge({ risk, short = false, className }: RiskBadgeProps) {
  if (!risk) return null;
  const presentation = RISK_PRESENTATION[risk.level];
  return (
    <span
      title={risk.reason || undefined}
      className={cn(
        'shrink-0 border px-1.5 py-px text-[10px] font-medium normal-case tracking-normal',
        presentation.className,
        className,
      )}
    >
      {short ? presentation.shortLabel : presentation.label}
    </span>
  );
}
