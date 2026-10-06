import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { createDraftThread, listDraftThreads } from './drafts';
import type { ReviewWorktreeRow } from './worktrees';

function makeRow(
  repoPath: string,
  headRefName: string,
  prNumber = 7,
  isCrossRepository = false,
): ReviewWorktreeRow {
  return {
    id: 1,
    repoPath,
    repoFullName: 'org/app',
    prNumber,
    worktreePath: '/wt',
    headRefName,
    headSha: 'sha',
    createdByReview: true,
    isCrossRepository,
    createdAt: '',
    updatedAt: '',
  };
}

const draft = (text: string) => ({
  filePath: 'src/a.ts',
  lineNumber: 1,
  side: 'modified' as const,
  codeLine: 'x',
  text,
});

describe('review drafts', () => {
  let ctx: TestContext;

  beforeEach(() => {
    ctx = setupTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it('[FR-PRMON-250] should list only drafts of the exact repo and branch', () => {
    createDraftThread(makeRow('/repos/a_p', 'feat/x'), draft('mine'));
    createDraftThread(makeRow('/repos/axp', 'feat/x'), draft('other repo'));
    createDraftThread(makeRow('/repos/a_p', 'featQ2Fx'), draft('other branch'));

    const listed = listDraftThreads(makeRow('/repos/a_p', 'feat/x'));

    expect(listed.map((thread) => thread.comments[0].body)).toEqual(['mine']);
  });

  it('[FR-PRMON-250] should not list drafts of another PR that shares the head branch name', () => {
    createDraftThread(makeRow('/repos/a', 'main', 7), draft('for PR 7'));
    createDraftThread(makeRow('/repos/a', 'main', 8), draft('for PR 8'));

    const listed = listDraftThreads(makeRow('/repos/a', 'main', 8));

    expect(listed.map((thread) => thread.comments[0].body)).toEqual(['for PR 8']);
  });

  it('[FR-PRREVIEW-151] should keep a cross-repo PR drafts apart from a same-repo PR with the same head branch name', () => {
    createDraftThread(makeRow('/repos/a', 'main', 7, false), draft('same repo'));
    createDraftThread(makeRow('/repos/a', 'main', 8, true), draft('fork'));

    const sameRepo = listDraftThreads(makeRow('/repos/a', 'main', 7, false));
    const fork = listDraftThreads(makeRow('/repos/a', 'main', 8, true));

    expect(sameRepo.map((thread) => thread.comments[0].body)).toEqual(['same repo']);
    expect(fork.map((thread) => thread.comments[0].body)).toEqual(['fork']);
    expect(fork[0].documentPath).toBe('diff:///repos/a#pull%2F8%2Fhead/src/a.ts');
  });
});
