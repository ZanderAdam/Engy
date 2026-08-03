import type { GhPrCheck, GhPrCiStatus } from '@engy/common';

export function deriveCheckState(
  status: string,
  conclusion: string | null,
): 'passing' | 'failing' | 'pending' {
  const lowerConclusion = conclusion?.toLowerCase();
  if (lowerConclusion === 'success' || lowerConclusion === 'skipped' || lowerConclusion === 'neutral') {
    return 'passing';
  }
  if (
    lowerConclusion === 'failure' ||
    lowerConclusion === 'timed_out' ||
    lowerConclusion === 'cancelled' ||
    lowerConclusion === 'action_required'
  ) {
    return 'failing';
  }
  // conclusion is null or unrecognized — use status (covers StatusContext entries)
  const lowerStatus = status.toLowerCase();
  if (lowerStatus === 'success') return 'passing';
  if (lowerStatus === 'failure' || lowerStatus === 'error') return 'failing';
  return 'pending';
}

export function ciStatusLabel(status: GhPrCiStatus): string {
  switch (status) {
    case 'passing':
      return 'Passing';
    case 'failing':
      return 'Failing';
    case 'pending':
      return 'Pending';
    case 'unknown':
      return 'Unknown';
  }
}

export function ciStatusClassName(status: GhPrCiStatus): string {
  switch (status) {
    case 'passing':
      return 'text-green-400 bg-green-400/10 border-green-400/20';
    case 'failing':
      return 'text-red-400 bg-red-400/10 border-red-400/20';
    case 'pending':
      return 'text-amber-400 bg-amber-400/10 border-amber-400/20';
    case 'unknown':
      return 'text-muted-foreground bg-muted/40 border-border';
  }
}

const REVIEW_DECISION_LABELS: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required',
};

export function reviewDecisionLabel(decision: string | null): string | null {
  if (!decision) return null;
  return REVIEW_DECISION_LABELS[decision] ?? decision;
}

export function formatRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) return 'just now';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Which PRs the tab lists: only the gh viewer's own PRs, or every open one. */
export type PrScope = 'mine' | 'all';

export function coercePrScope(value: string | null | undefined): PrScope {
  return value === 'all' ? 'all' : 'mine';
}

export function filterPrsByScope<T extends { authoredByViewer: boolean }>(
  prs: T[],
  scope: PrScope,
): T[] {
  return scope === 'all' ? prs : prs.filter((pr) => pr.authoredByViewer);
}

interface CheckSummary {
  passing: number;
  failing: number;
  pending: number;
  total: number;
}

export function summarizeChecks(checks: GhPrCheck[]): CheckSummary {
  let passing = 0;
  let failing = 0;
  let pending = 0;

  for (const check of checks) {
    const state = deriveCheckState(check.status, check.conclusion);
    if (state === 'passing') passing++;
    else if (state === 'failing') failing++;
    else pending++;
  }

  return { passing, failing, pending, total: checks.length };
}
