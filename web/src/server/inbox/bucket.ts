import type { INBOX_EVENT_KINDS } from '../db/schema';

export type InboxEventKind = (typeof INBOX_EVENT_KINDS)[number];
export type InboxBucket = 'priority' | 'other';

export interface BucketFacts {
  reviewRequestedNotGiven: boolean;
  mentioned: boolean;
  myPrChangesRequested: boolean;
  myPrCiFailing: boolean;
  myPrAutoFixAttention: boolean;
  myPrApprovedCiPassing: boolean;
}

export const NO_BUCKET_FACTS: BucketFacts = {
  reviewRequestedNotGiven: false,
  mentioned: false,
  myPrChangesRequested: false,
  myPrCiFailing: false,
  myPrAutoFixAttention: false,
  myPrApprovedCiPassing: false,
};

const PRIORITY_EVENT_KINDS: ReadonlySet<InboxEventKind> = new Set([
  'review_requested',
  'mentioned',
  'changes_requested',
  'approved',
  'ci_failed',
  'ci_passed',
  'auto_fix_attention',
]);

export function computeBucket(facts: BucketFacts): InboxBucket {
  return Object.values(facts).some(Boolean) ? 'priority' : 'other';
}

export function wakesSnooze(kind: InboxEventKind, bucket: InboxBucket): boolean {
  return bucket === 'priority' && PRIORITY_EVENT_KINDS.has(kind);
}

export function isSnoozeDue(snoozedUntil: string | null, now: Date): boolean {
  return snoozedUntil !== null && snoozedUntil <= now.toISOString();
}
