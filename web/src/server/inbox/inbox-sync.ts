import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { prs, workspaces } from '../db/schema';
import type { GithubNotification } from '../github/notifications';
import { resolveRepoFullName } from '../github/repo-identity';
import { getViewerTeams } from '../github/teams';
import { maybeStartAutoReview } from '../review/auto-review';
import {
  fetchPrTimeline,
  sameLogin,
  type PrTimeline,
  type TimelineEvent,
} from '../github/timeline';
import type { AppState } from '../trpc/context';
import { NO_BUCKET_FACTS, type BucketFacts, type InboxEventKind } from './bucket';
import { bucketFactsForPr } from './pr-events';
import { addEvent, findItemByPr, getItem, markRead, upsertItem } from './store';

interface RepoLocation {
  workspaceId: number;
  repoPath: string;
}

type RepoIndex = Map<string, RepoLocation>;

interface ThreadSyncContext {
  state: AppState;
  viewerLogin: string;
  repoIndex: RepoIndex;
  lastSyncedAt: string | null;
}

const PR_NUMBER_PATTERN = /\/pulls\/(\d+)$/;

const REASON_EVENTS: Record<string, { kind: InboxEventKind; summary: string }> = {
  review_requested: { kind: 'review_requested', summary: 'Review requested' },
  mention: { kind: 'mentioned', summary: 'You were mentioned' },
  team_mention: { kind: 'mentioned', summary: 'Your team was mentioned' },
  assign: { kind: 'assigned', summary: 'You were assigned' },
};

const DEFAULT_REASON_EVENT = { kind: 'commented' as const, summary: 'New activity' };

export async function buildRepoIndex(state: AppState): Promise<RepoIndex> {
  const index: RepoIndex = new Map();
  const allWorkspaces = getDb().select().from(workspaces).all();
  for (const workspace of allWorkspaces) {
    for (const repoPath of workspace.repos ?? []) {
      try {
        const fullName = (await resolveRepoFullName(state, repoPath))?.toLowerCase();
        if (fullName && !index.has(fullName)) {
          index.set(fullName, { workspaceId: workspace.id, repoPath });
        }
      } catch {
        continue;
      }
    }
  }
  return index;
}

function parsePrNumber(subjectUrl: string | null): number | null {
  const match = subjectUrl ? PR_NUMBER_PATTERN.exec(subjectUrl) : null;
  return match ? Number(match[1]) : null;
}

function buildFacts(
  pr: PrTimeline,
  viewerLogin: string,
  viewerTeams: ReadonlySet<string>,
  repoFullName: string,
  prNumber: number,
): BucketFacts {
  const row = getDb()
    .select()
    .from(prs)
    .where(and(eq(prs.repoFullName, repoFullName), eq(prs.number, prNumber)))
    .get();
  if (row) return bucketFactsForPr(row, viewerLogin, viewerTeams);

  if (pr.state !== 'OPEN') return NO_BUCKET_FACTS;
  if (!sameLogin(pr.authorLogin, viewerLogin)) {
    return { ...NO_BUCKET_FACTS, reviewRequestedNotGiven: pr.viewerReviewRequested };
  }
  return {
    ...NO_BUCKET_FACTS,
    myPrChangesRequested: pr.reviewDecision === 'CHANGES_REQUESTED',
  };
}

function reasonEvent(thread: GithubNotification, itemExists: boolean): TimelineEvent {
  const mapped = itemExists
    ? DEFAULT_REASON_EVENT
    : (REASON_EVENTS[thread.reason] ?? DEFAULT_REASON_EVENT);
  return {
    ...mapped,
    actor: null,
    url: null,
    at: thread.updated_at,
    sourceKey: `ghn:${thread.id}:${thread.updated_at}`,
  };
}

function eventsForThread(
  thread: GithubNotification,
  timeline: PrTimeline | null,
  repoFullName: string,
  prNumber: number,
): TimelineEvent[] {
  const itemExists = findItemByPr(repoFullName, prNumber) !== undefined;
  if (timeline === null) return [reasonEvent(thread, itemExists)];
  if (timeline.events.length > 0) return timeline.events;
  return itemExists ? [] : [reasonEvent(thread, false)];
}

async function loadTimeline(
  ctx: ThreadSyncContext,
  thread: GithubNotification,
  prNumber: number,
  viewerTeams: ReadonlySet<string>,
): Promise<PrTimeline | null> {
  const [owner, name] = thread.repository.full_name.split('/');
  try {
    return await fetchPrTimeline(ctx.state, {
      owner,
      name,
      number: prNumber,
      since: ctx.lastSyncedAt ?? thread.last_read_at,
      viewerLogin: ctx.viewerLogin,
      viewerTeams,
      pushedAt: thread.updated_at,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `[inbox] timeline fetch failed for ${thread.repository.full_name}#${prNumber}: ${message}`,
    );
    return null;
  }
}

function startAutoReview(
  state: AppState,
  workspaceId: number,
  repoFullName: string,
  prNumber: number,
): void {
  maybeStartAutoReview(state, { workspaceId, repoFullName, prNumber }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[inbox] auto review failed for ${repoFullName}#${prNumber}: ${message}`);
  });
}

export async function syncThread(
  ctx: ThreadSyncContext,
  thread: GithubNotification,
): Promise<void> {
  const prNumber = parsePrNumber(thread.subject.url);
  if (prNumber === null) return;

  const repoFullName = thread.repository.full_name;
  const location = ctx.repoIndex.get(repoFullName.toLowerCase());
  const viewerTeams = await getViewerTeams(ctx.state);
  const timeline = await loadTimeline(ctx, thread, prNumber, viewerTeams);

  const events = eventsForThread(thread, timeline, repoFullName, prNumber);
  const firstEventAt = events.reduce<string | undefined>(
    (earliest, event) => (earliest === undefined || event.at < earliest ? event.at : earliest),
    undefined,
  );

  const base = {
    repoFullName,
    prNumber,
    title: timeline?.title ?? thread.subject.title,
    url: `https://github.com/${repoFullName}/pull/${prNumber}`,
    githubThreadId: thread.id,
    workspaceId: location?.workspaceId,
    repoPath: location?.repoPath,
  };
  const item = upsertItem({ ...base, firstEventAt });

  const facts = timeline
    ? buildFacts(timeline, ctx.viewerLogin, viewerTeams, repoFullName, prNumber)
    : undefined;

  for (const event of events) {
    const isNew = addEvent({ itemId: item.id, ...event, facts });
    if (isNew && event.kind === 'review_requested' && location) {
      startAutoReview(ctx.state, location.workspaceId, repoFullName, prNumber);
    }
  }
  if (facts) upsertItem({ ...base, facts });

  const current = getItem(item.id);
  if (
    current?.unread &&
    !thread.unread &&
    thread.last_read_at &&
    thread.last_read_at > current.lastEventAt
  ) {
    markRead(item.id);
  }
}
