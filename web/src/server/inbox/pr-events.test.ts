import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { inboxEvents, inboxItems, workspaces, type prs } from '../db/schema';
import * as broadcast from '../ws/broadcast';
import type { MaterialChange } from '../trpc/routers/pr';
import {
  bucketFactsForPr,
  mapAttention,
  mapPrChange,
  recordPrInboxEvents,
  refreshPrFacts,
  reviewRequestedFrom,
} from './pr-events';

type PrRow = typeof prs.$inferSelect;

function makeRow(overrides: Partial<PrRow> = {}): PrRow {
  return {
    id: 1,
    repo: '/repo',
    number: 7,
    title: 'My PR',
    url: 'https://github.com/org/repo/pull/7',
    headBranch: 'feat/x',
    headSha: 'sha1',
    author: 'me',
    isDraft: false,
    ciStatus: 'passing',
    checks: [],
    commentCount: 0,
    authoredByViewer: true,
    reviewDecision: null,
    repoFullName: 'org/repo',
    baseRef: 'main',
    additions: 0,
    deletions: 0,
    reviewRequests: [],
    lastFailedHeadSha: null,
    autoFixAttempts: 0,
    autoFixTotalAttempts: 0,
    attentionReason: null,
    githubUpdatedAt: null,
    hasConflicts: false,
    isCrossRepository: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function ciChange(previous: string | null, current: string): MaterialChange {
  return { number: 7, repo: '/repo', type: 'ciStatus', previous, current };
}

describe('[FR-INBOX-040] bucketFactsForPr', () => {
  it('should flag a review request on a PR the viewer did not author', () => {
    const row = makeRow({ authoredByViewer: false, reviewRequests: ['me', 'bob'] });
    expect(bucketFactsForPr(row, 'me').reviewRequestedNotGiven).toBe(true);
  });

  it('should match the viewer login case-insensitively', () => {
    const row = makeRow({ authoredByViewer: false, reviewRequests: ['Me'] });
    expect(bucketFactsForPr(row, 'me').reviewRequestedNotGiven).toBe(true);
  });

  it('should flag a team request only when the viewer is in that team', () => {
    const row = makeRow({ authoredByViewer: false, reviewRequests: ['Acme/core'] });
    expect(bucketFactsForPr(row, 'me', new Set(['acme/core'])).reviewRequestedNotGiven).toBe(true);
    expect(bucketFactsForPr(row, 'me', new Set(['acme/other'])).reviewRequestedNotGiven).toBe(
      false,
    );
    expect(bucketFactsForPr(row, 'me').reviewRequestedNotGiven).toBe(false);
  });

  it('should not flag a review request for another login or an unknown viewer', () => {
    const row = makeRow({ authoredByViewer: false, reviewRequests: ['bob'] });
    expect(bucketFactsForPr(row, 'me').reviewRequestedNotGiven).toBe(false);
    expect(bucketFactsForPr({ ...row, reviewRequests: ['me'] }, null).reviewRequestedNotGiven).toBe(
      false,
    );
  });

  it('should derive own-PR facts for an authored PR', () => {
    expect(bucketFactsForPr(makeRow({ reviewDecision: 'CHANGES_REQUESTED' }), 'me')).toMatchObject({
      myPrChangesRequested: true,
    });
    expect(bucketFactsForPr(makeRow({ ciStatus: 'failing' }), 'me').myPrCiFailing).toBe(true);
    expect(bucketFactsForPr(makeRow({ attentionReason: 'uncorrelated' }), 'me')).toMatchObject({
      myPrAutoFixAttention: true,
    });
    expect(bucketFactsForPr(makeRow({ reviewDecision: 'APPROVED' }), 'me')).toMatchObject({
      myPrApprovedCiPassing: true,
    });
  });

  it('should not derive own-PR facts when the viewer is not the author', () => {
    const row = makeRow({
      authoredByViewer: false,
      ciStatus: 'failing',
      reviewDecision: 'CHANGES_REQUESTED',
      attentionReason: 'uncorrelated',
    });
    expect(bucketFactsForPr(row, 'me')).toEqual({
      reviewRequestedNotGiven: false,
      mentioned: false,
      myPrChangesRequested: false,
      myPrCiFailing: false,
      myPrAutoFixAttention: false,
      myPrApprovedCiPassing: false,
    });
  });

  it('should not report approved when CI is not passing', () => {
    const row = makeRow({ reviewDecision: 'APPROVED', ciStatus: 'pending' });
    expect(bucketFactsForPr(row, 'me').myPrApprovedCiPassing).toBe(false);
  });
});

describe('[FR-INBOX-590] reviewRequestedFrom', () => {
  const teams = new Set(['acme/web', 'acme/api']);

  it('should mark a direct request to the viewer, in any case', () => {
    expect(reviewRequestedFrom(['Octocat'], 'octocat', teams)).toEqual({
      viewer: true,
      teams: [],
    });
  });

  it('should list only the viewer teams among requested reviewers', () => {
    expect(reviewRequestedFrom(['acme/web', 'acme/other', 'bob'], 'octocat', teams)).toEqual({
      viewer: false,
      teams: ['acme/web'],
    });
  });

  it('should report both a direct and a team request', () => {
    expect(reviewRequestedFrom(['octocat', 'ACME/API'], 'octocat', teams)).toEqual({
      viewer: true,
      teams: ['acme/api'],
    });
  });

  it('should report nothing without a viewer login', () => {
    expect(reviewRequestedFrom(['octocat'], null, teams)).toEqual({ viewer: false, teams: [] });
  });
});

describe('mapPrChange', () => {
  it.each([
    ['passing', 'failing'],
    ['pending', 'failing'],
    [null, 'failing'],
  ])('should emit ci_failed for %s to %s', (previous, current) => {
    expect(mapPrChange(ciChange(previous, current), makeRow())).toEqual([
      {
        kind: 'ci_failed',
        summary: 'CI failed',
        actor: 'CI',
        sourceKey: 'ci:org/repo#7:sha1:failing',
      },
    ]);
  });

  it.each(['failing', 'pending'])(
    'should emit ci_passed when %s recovers on own PR',
    (previous) => {
      expect(mapPrChange(ciChange(previous, 'passing'), makeRow())).toEqual([
        {
          kind: 'ci_passed',
          summary: 'CI passed',
          actor: 'CI',
          sourceKey: 'ci:org/repo#7:sha1:passing',
        },
      ]);
    },
  );

  it('should not emit ci_passed for PRs the viewer did not author', () => {
    const row = makeRow({ authoredByViewer: false });
    expect(mapPrChange(ciChange('failing', 'passing'), row)).toEqual([]);
  });

  it('should not emit ci_passed for first-seen or unknown to passing', () => {
    expect(mapPrChange(ciChange('unknown', 'passing'), makeRow())).toEqual([]);
    expect(mapPrChange(ciChange(null, 'passing'), makeRow())).toEqual([]);
  });

  it('should ignore non-CI changes', () => {
    const change: MaterialChange = {
      number: 7,
      repo: '/repo',
      type: 'reviewDecision',
      current: 'APPROVED',
    };
    expect(mapPrChange(change, makeRow())).toEqual([]);
  });
});

describe('[FR-INBOX-050] mapAttention', () => {
  it('should emit auto_fix_attention with the shared label', () => {
    expect(mapAttention(makeRow(), 'non-mechanical')).toEqual([
      {
        kind: 'auto_fix_attention',
        summary: 'CI failure needs manual attention',
        actor: null,
        sourceKey: 'attention:org/repo#7:sha1:non-mechanical',
      },
    ]);
  });

  it('should emit nothing for an empty reason', () => {
    expect(mapAttention(makeRow(), '')).toEqual([]);
  });
});

describe('[FR-INBOX-060] inbox recording', () => {
  let ctx: TestContext;
  let workspaceId: number;

  beforeEach(() => {
    ctx = setupTestDb();
    vi.spyOn(broadcast, 'broadcastInboxChange').mockImplementation(() => undefined);
    workspaceId = ctx.db
      .insert(workspaces)
      .values({ name: 'ws', slug: 'ws', repos: [] })
      .returning()
      .get().id;
  });

  afterEach(() => {
    ctx.cleanup();
    vi.restoreAllMocks();
  });

  it('should create a priority item and dedupe repeated events', () => {
    const row = makeRow({ ciStatus: 'failing' });
    const events = mapPrChange(ciChange('passing', 'failing'), row);

    recordPrInboxEvents({ prRow: row, workspaceId, viewerLogin: 'me', events });
    recordPrInboxEvents({ prRow: row, workspaceId, viewerLogin: 'me', events });

    const items = ctx.db.select().from(inboxItems).all();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      bucket: 'priority',
      latestReason: 'ci_failed',
      repoPath: '/repo',
    });
    expect(ctx.db.select().from(inboxEvents).all()).toHaveLength(1);
  });

  it('[FR-PRMON-220] should stamp a CI event with the time the failing check completed', () => {
    const row = makeRow({
      ciStatus: 'failing',
      checks: [
        {
          name: 'a',
          status: 'COMPLETED',
          conclusion: 'FAILURE',
          detailsUrl: null,
          completedAt: '2026-02-01T02:00:00Z',
        },
        {
          name: 'b',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          detailsUrl: null,
          completedAt: '2026-02-01T05:00:00Z',
        },
      ],
    });
    const now = new Date('2026-02-01T09:00:00Z');

    recordPrInboxEvents({
      prRow: row,
      workspaceId,
      viewerLogin: 'me',
      events: mapPrChange(ciChange('passing', 'failing'), row),
      now,
    });

    expect(ctx.db.select().from(inboxEvents).get()?.at).toBe('2026-02-01T02:00:00Z');
    expect(ctx.db.select().from(inboxItems).get()?.lastEventAt).toBe('2026-02-01T02:00:00Z');
  });

  it('[FR-PRMON-220] should stamp ci_passed with the newest completion time', () => {
    const row = makeRow({
      checks: [
        {
          name: 'a',
          status: 'COMPLETED',
          conclusion: 'SUCCESS',
          detailsUrl: null,
          completedAt: '2026-02-01T02:00:00Z',
        },
        {
          name: 'b',
          status: 'COMPLETED',
          conclusion: 'SKIPPED',
          detailsUrl: null,
          completedAt: '2026-02-01T05:00:00Z',
        },
      ],
    });

    recordPrInboxEvents({
      prRow: row,
      workspaceId,
      viewerLogin: 'me',
      events: mapPrChange(ciChange('failing', 'passing'), row),
      now: new Date('2026-02-01T09:00:00Z'),
    });

    expect(ctx.db.select().from(inboxEvents).get()?.at).toBe('2026-02-01T05:00:00Z');
  });

  it('[FR-PRMON-220] should fall back to the poll time when no check time is known', () => {
    const row = makeRow({ ciStatus: 'failing' });
    const now = new Date('2026-02-01T09:00:00Z');

    recordPrInboxEvents({
      prRow: row,
      workspaceId,
      viewerLogin: 'me',
      events: mapPrChange(ciChange('passing', 'failing'), row),
      now,
    });

    expect(ctx.db.select().from(inboxEvents).get()?.at).toBe(now.toISOString());
  });

  it('should not create an item when there are no events', () => {
    recordPrInboxEvents({ prRow: makeRow(), workspaceId, viewerLogin: 'me', events: [] });
    expect(ctx.db.select().from(inboxItems).all()).toHaveLength(0);
  });

  it('should refresh the bucket of an existing item only', () => {
    const failing = makeRow({ ciStatus: 'failing' });
    refreshPrFacts(failing, 'me');
    expect(ctx.db.select().from(inboxItems).all()).toHaveLength(0);

    recordPrInboxEvents({
      prRow: failing,
      workspaceId,
      viewerLogin: 'me',
      events: mapPrChange(ciChange('passing', 'failing'), failing),
    });
    refreshPrFacts(makeRow({ ciStatus: 'passing' }), 'me');

    expect(ctx.db.select().from(inboxItems).get()?.bucket).toBe('other');
  });
});
