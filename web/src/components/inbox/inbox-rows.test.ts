import { describe, it, expect } from 'vitest';
import { inboxItemToRow, myPullRequestRows, type WorkspacePr } from './inbox-rows';
import type { InboxItem } from './inbox-helpers';

function pr(overrides: Partial<WorkspacePr>): WorkspacePr {
  return {
    number: 1,
    title: 'Add thing',
    url: 'https://github.com/acme/web/pull/1',
    author: 'alice',
    isDraft: false,
    ciStatus: 'pending',
    reviewDecision: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    authoredByViewer: true,
    repoFullName: 'acme/web',
    projectSlug: 'default',
    ...overrides,
  } as WorkspacePr;
}

function item(overrides: Partial<InboxItem>): InboxItem {
  return {
    id: 7,
    repoFullName: 'acme/web',
    prNumber: 1,
    title: 'Add thing',
    url: 'https://github.com/acme/web/pull/1',
    unread: true,
    snoozedUntil: null,
    workspaceId: 1,
    projectSlug: null,
    risk: null,
    lastEventAt: '2026-01-02T00:00:00.000Z',
    latestEvent: null,
    events: [],
    ...overrides,
  } as InboxItem;
}

describe('[FR-INBOX-490] myPullRequestRows', () => {
  it('should list only authored PRs, including PRs without an inbox item', () => {
    const rows = myPullRequestRows(
      [pr({ number: 1 }), pr({ number: 2, authoredByViewer: false })],
      [],
      1,
    );

    expect(rows.map((row) => row.prNumber)).toEqual([1]);
    expect(rows[0].item).toBeNull();
    expect(rows[0].unread).toBe(false);
    expect(rows[0].workspaceId).toBe(1);
  });

  it('should name the review state of each PR', () => {
    const summaries = myPullRequestRows(
      [
        pr({ number: 1, isDraft: true }),
        pr({ number: 2, reviewDecision: 'CHANGES_REQUESTED' }),
        pr({ number: 3, reviewDecision: 'APPROVED' }),
        pr({ number: 4 }),
      ],
      [],
      1,
    )
      .sort((a, b) => a.prNumber - b.prNumber)
      .map((row) => row.summary);

    expect(summaries).toEqual(['Draft', 'Changes requested', 'Approved', 'Waiting for review']);
  });

  it('should link the inbox item of a PR for the unread dot and item actions', () => {
    const [row] = myPullRequestRows([pr({ number: 1 })], [item({ id: 7, unread: true })], 1);

    expect(row.unread).toBe(true);
    expect(row.item?.id).toBe(7);
  });

  it('[FR-PRMON-230] should show when the PR last changed on GitHub', () => {
    const [row] = myPullRequestRows(
      [
        pr({
          number: 1,
          githubUpdatedAt: '2026-09-01T10:00:00Z',
          updatedAt: '2026-10-02T21:00:00Z',
        }),
      ],
      [],
      1,
    );

    expect(row.at).toBe('2026-09-01T10:00:00Z');
  });

  it('should skip a PR without a GitHub repository name', () => {
    expect(myPullRequestRows([pr({ repoFullName: null })], [], 1)).toEqual([]);
  });
});

describe('[FR-INBOX-490] inboxItemToRow', () => {
  it('should share one key with the PR row of the same PR', () => {
    const [prRow] = myPullRequestRows([pr({ number: 1 })], [], 1);

    expect(inboxItemToRow(item({}), undefined).key).toBe(prRow.key);
  });

  it('should take CI from the PR when known', () => {
    expect(inboxItemToRow(item({}), pr({ ciStatus: 'failing' })).ci).toBe('failing');
  });
});
