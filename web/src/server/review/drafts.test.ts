import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDb, type TestContext } from '../trpc/test-helpers';
import { createDraftThread, listDraftThreads } from './drafts';
import type { ReviewWorktreeRow } from './worktrees';

function makeRow(repoPath: string, headRefName: string, prNumber = 7): ReviewWorktreeRow {
  return {
    id: 1,
    repoPath,
    repoFullName: 'org/app',
    prNumber,
    worktreePath: '/wt',
    headRefName,
    headSha: 'sha',
    createdByReview: true,
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
});
