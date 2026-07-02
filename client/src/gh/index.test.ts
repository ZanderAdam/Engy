import { describe, it, expect } from 'vitest';
import { listOpenPrs, checkAuthStatus, type GhRunner } from './index.js';

function makeRunner(stdout: string): GhRunner {
  return async () => ({ stdout, stderr: '' });
}

function makeErrorRunner(err: Partial<NodeJS.ErrnoException>): GhRunner {
  return async () => {
    const e = Object.assign(new Error(err.message ?? 'command failed'), err);
    throw e;
  };
}

const EMPTY_PR_LIST = '[]';

const SINGLE_PR_NO_CHECKS = JSON.stringify([
  {
    number: 1,
    title: 'My PR',
    url: 'https://github.com/owner/repo/pull/1',
    headRefName: 'feature',
    author: { login: 'alice' },
    isDraft: false,
    state: 'OPEN',
    reviewDecision: null,
    statusCheckRollup: null,
  },
]);

describe('listOpenPrs', () => {
  it('returns empty array when no PRs', async () => {
    const prs = await listOpenPrs('/repo', makeRunner(EMPTY_PR_LIST));
    expect(prs).toEqual([]);
  });

  it('maps raw PR fields to GhPr shape', async () => {
    const prs = await listOpenPrs('/repo', makeRunner(SINGLE_PR_NO_CHECKS));
    expect(prs).toHaveLength(1);
    expect(prs[0]).toMatchObject({
      number: 1,
      title: 'My PR',
      url: 'https://github.com/owner/repo/pull/1',
      headBranch: 'feature',
      author: 'alice',
      isDraft: false,
      state: 'OPEN',
      reviewDecision: null,
    });
  });

  it('derives ciStatus as unknown for null statusCheckRollup', async () => {
    const prs = await listOpenPrs('/repo', makeRunner(SINGLE_PR_NO_CHECKS));
    expect(prs[0].ciStatus).toBe('unknown');
    expect(prs[0].checks).toEqual([]);
  });

  it('derives ciStatus as unknown for empty statusCheckRollup', async () => {
    const raw = JSON.stringify([
      { ...JSON.parse(SINGLE_PR_NO_CHECKS)[0], statusCheckRollup: [] },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('unknown');
  });

  it('derives ciStatus as failing when CheckRun has failure conclusion', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'failure', detailsUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('failing');
  });

  it('derives ciStatus as failing when CheckRun has timed_out conclusion', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'timed_out', detailsUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('failing');
  });

  it('derives ciStatus as failing when StatusContext has FAILURE state', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'StatusContext', context: 'coverage', state: 'FAILURE', targetUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('failing');
  });

  it('derives ciStatus as failing when StatusContext has ERROR state', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'StatusContext', context: 'ci', state: 'ERROR', targetUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('failing');
  });

  it('derives ciStatus as pending when CheckRun is in_progress', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('pending');
  });

  it('derives ciStatus as pending when CheckRun is queued', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'QUEUED', conclusion: null, detailsUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('pending');
  });

  it('derives ciStatus as pending when StatusContext has PENDING state', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'StatusContext', context: 'coverage', state: 'PENDING', targetUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('pending');
  });

  it('derives ciStatus as passing when all checks succeed', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'success', detailsUrl: 'https://ci.example.com' },
          { __typename: 'StatusContext', context: 'coverage', state: 'SUCCESS', targetUrl: 'https://coverage.example.com' },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('passing');
  });

  it('derives ciStatus as passing for skipped/neutral checks', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'optional', status: 'COMPLETED', conclusion: 'skipped', detailsUrl: null },
          { __typename: 'CheckRun', name: 'info', status: 'COMPLETED', conclusion: 'neutral', detailsUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('passing');
  });

  it('failing takes priority over pending', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'IN_PROGRESS', conclusion: null, detailsUrl: null },
          { __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'failure', detailsUrl: null },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].ciStatus).toBe('failing');
  });

  it('normalizes CheckRun to GhPrCheck shape', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'CheckRun', name: 'CI', status: 'COMPLETED', conclusion: 'success', detailsUrl: 'https://ci.example.com' },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].checks).toEqual([
      { name: 'CI', status: 'COMPLETED', conclusion: 'success', detailsUrl: 'https://ci.example.com' },
    ]);
  });

  it('normalizes StatusContext to GhPrCheck shape', async () => {
    const raw = JSON.stringify([
      {
        ...JSON.parse(SINGLE_PR_NO_CHECKS)[0],
        statusCheckRollup: [
          { __typename: 'StatusContext', context: 'coverage', state: 'SUCCESS', targetUrl: 'https://cov.example.com' },
        ],
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].checks).toEqual([
      { name: 'coverage', status: 'SUCCESS', conclusion: null, detailsUrl: 'https://cov.example.com' },
    ]);
  });
});

describe('checkAuthStatus', () => {
  it('returns ok: true when gh auth status exits zero', async () => {
    const status = await checkAuthStatus(makeRunner('Logged in to github.com account alice'));
    expect(status).toEqual({ ok: true });
  });

  it('returns not-installed when gh is not found (ENOENT)', async () => {
    const status = await checkAuthStatus(makeErrorRunner({ code: 'ENOENT', message: 'spawn gh ENOENT' }));
    expect(status).toEqual({ ok: false, reason: 'not-installed' });
  });

  it('returns not-authenticated when gh exits non-zero', async () => {
    const status = await checkAuthStatus(makeErrorRunner({ message: 'Command failed: gh auth status' }));
    expect(status).toEqual({ ok: false, reason: 'not-authenticated' });
  });
});
