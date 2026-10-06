import type { prs } from '../db/schema';
import type { MaterialChange } from '../trpc/routers/pr';
import { getAttentionInfo } from '../../lib/pr-attention';
import { deriveCheckState, type CheckState } from '../../lib/pr-check-state';
import { NO_BUCKET_FACTS, type BucketFacts, type InboxEventKind } from './bucket';
import { addEvent, findItemByPr, upsertItem } from './store';

type PrRow = typeof prs.$inferSelect;

interface PrInboxEvent {
  kind: InboxEventKind;
  summary: string;
  actor: string | null;
  sourceKey: string;
  at?: string;
}

interface ReviewRequestedFrom {
  viewer: boolean;
  teams: string[];
}

export function reviewRequestedFrom(
  reviewRequests: string[],
  viewerLogin: string | null,
  viewerTeams: ReadonlySet<string> = new Set(),
): ReviewRequestedFrom {
  const login = viewerLogin?.toLowerCase();
  const names = reviewRequests.map((name) => name.toLowerCase());
  return {
    viewer: !!login && names.includes(login),
    teams: names.filter((name) => viewerTeams.has(name)),
  };
}

export function bucketFactsForPr(
  prRow: PrRow,
  viewerLogin: string | null,
  viewerTeams: ReadonlySet<string> = new Set(),
): BucketFacts {
  const authored = prRow.authoredByViewer;
  const requested = reviewRequestedFrom(prRow.reviewRequests, viewerLogin, viewerTeams);
  return {
    ...NO_BUCKET_FACTS,
    reviewRequestedNotGiven:
      !!viewerLogin && !authored && (requested.viewer || requested.teams.length > 0),
    myPrChangesRequested: authored && prRow.reviewDecision === 'CHANGES_REQUESTED',
    myPrCiFailing: authored && prRow.ciStatus === 'failing',
    myPrAutoFixAttention: authored && prRow.attentionReason !== null,
    myPrApprovedCiPassing:
      authored && prRow.reviewDecision === 'APPROVED' && prRow.ciStatus === 'passing',
  };
}

function prKey(prRow: PrRow): string {
  return `${prRow.repoFullName}#${prRow.number}:${prRow.headSha ?? 'unknown'}`;
}

function latestCheckTime(prRow: PrRow, state?: CheckState): string | undefined {
  const times = prRow.checks
    .filter(
      (check) => state === undefined || deriveCheckState(check.status, check.conclusion) === state,
    )
    .map((check) => check.completedAt)
    .filter((time): time is string => !!time);
  return times.reduce<string | undefined>(
    (latest, time) => (latest === undefined || time > latest ? time : latest),
    undefined,
  );
}

export function mapPrChange(change: MaterialChange, prRow: PrRow): PrInboxEvent[] {
  if (change.type !== 'ciStatus') return [];
  const sourceKey = `ci:${prKey(prRow)}:${change.current}`;
  if (change.current === 'failing') {
    return [
      {
        kind: 'ci_failed',
        summary: 'CI failed',
        actor: 'CI',
        sourceKey,
        at: latestCheckTime(prRow, 'failing'),
      },
    ];
  }
  const recovered = change.previous === 'failing' || change.previous === 'pending';
  if (change.current === 'passing' && recovered && prRow.authoredByViewer) {
    return [
      {
        kind: 'ci_passed',
        summary: 'CI passed',
        actor: 'CI',
        sourceKey,
        at: latestCheckTime(prRow),
      },
    ];
  }
  return [];
}

export function mapAttention(prRow: PrRow, reason: string): PrInboxEvent[] {
  const info = getAttentionInfo(reason);
  if (!info) return [];
  return [
    {
      kind: 'auto_fix_attention',
      summary: info.label,
      actor: null,
      sourceKey: `attention:${prKey(prRow)}:${reason}`,
    },
  ];
}

interface RecordInput {
  prRow: PrRow;
  workspaceId: number;
  viewerLogin: string | null;
  viewerTeams?: ReadonlySet<string>;
  events: PrInboxEvent[];
  now?: Date;
}

export function recordPrInboxEvents({
  prRow,
  workspaceId,
  viewerLogin,
  viewerTeams,
  events,
  now = new Date(),
}: RecordInput): void {
  if (events.length === 0 || !prRow.repoFullName) return;
  const facts = bucketFactsForPr(prRow, viewerLogin, viewerTeams);
  const timed = events.map((event) => ({ ...event, at: event.at ?? now.toISOString() }));
  const firstEventAt = timed.reduce(
    (earliest, event) => (event.at < earliest ? event.at : earliest),
    timed[0].at,
  );
  const item = upsertItem(
    {
      repoFullName: prRow.repoFullName,
      prNumber: prRow.number,
      title: prRow.title,
      url: prRow.url,
      workspaceId,
      repoPath: prRow.repo,
      facts,
      firstEventAt,
    },
    now,
  );
  for (const event of timed) {
    addEvent({ itemId: item.id, ...event, facts }, now);
  }
}

export function refreshPrFacts(
  prRow: PrRow,
  viewerLogin: string | null,
  viewerTeams?: ReadonlySet<string>,
  now?: Date,
): void {
  if (!prRow.repoFullName) return;
  const item = findItemByPr(prRow.repoFullName, prRow.number);
  if (!item) return;
  upsertItem(
    {
      repoFullName: item.repoFullName,
      prNumber: item.prNumber,
      title: prRow.title,
      url: prRow.url,
      facts: bucketFactsForPr(prRow, viewerLogin, viewerTeams),
    },
    now,
  );
}
