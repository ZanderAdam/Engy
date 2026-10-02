import type { ComponentType } from 'react';
import {
  RiArrowGoBackLine,
  RiCheckDoubleLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiDraftLine,
  RiErrorWarningLine,
  RiGitPullRequestLine,
} from '@remixicon/react';
import type { GhPrCiStatus } from '@engy/common';

interface PrStateFacts {
  isDraft: boolean;
  hasConflicts: boolean;
  ciStatus: GhPrCiStatus;
  reviewDecision: string | null;
}

export interface PrStateVisual {
  icon: ComponentType<{ className?: string }>;
  className: string;
  label: string;
}

export function prStateVisual(pr: PrStateFacts): PrStateVisual {
  if (pr.isDraft) {
    return { icon: RiDraftLine, className: 'text-muted-foreground', label: 'Draft' };
  }
  if (pr.hasConflicts) {
    return { icon: RiErrorWarningLine, className: 'text-orange-400', label: 'Merge conflicts' };
  }
  if (pr.ciStatus === 'failing') {
    return { icon: RiCloseCircleLine, className: 'text-red-400', label: 'CI failing' };
  }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') {
    return { icon: RiArrowGoBackLine, className: 'text-amber-400', label: 'Changes requested' };
  }
  if (pr.reviewDecision === 'APPROVED' && pr.ciStatus === 'passing') {
    return { icon: RiCheckDoubleLine, className: 'text-green-400', label: 'Ready to merge' };
  }
  if (pr.reviewDecision === 'APPROVED') {
    return { icon: RiCheckLine, className: 'text-green-400', label: 'Approved' };
  }
  return {
    icon: RiGitPullRequestLine,
    className: 'text-foreground/70',
    label: 'Waiting for review',
  };
}
