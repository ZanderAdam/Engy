import { RiAlertLine } from '@remixicon/react';

// The dock tab and TerminalSessionLabel render the label block separately, so
// anything shown in both lives here or it drifts out of one of them.
export function AttentionBadge({ needsAttention }: { needsAttention?: boolean }) {
  if (!needsAttention) return null;
  return <RiAlertLine className="size-3 shrink-0 text-amber-400" aria-label="Needs attention" />;
}
