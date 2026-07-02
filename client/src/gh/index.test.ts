import { describe, it, expect } from 'vitest';
import { listOpenPrs, fetchFailedLogs, checkAuthStatus, type GhRunner } from './index.js';


function makeRunner(stdout: string): GhRunner {
  return async () => ({ stdout, stderr: '' });
}

function makeErrorRunner(err: Partial<NodeJS.ErrnoException> & { stderr?: string }): GhRunner {
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
    headRefOid: 'abc123def456',
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
      headSha: 'abc123def456',
      author: 'alice',
      isDraft: false,
      state: 'OPEN',
      reviewDecision: null,
    });
  });

  it('returns headSha as null when headRefOid is absent', async () => {
    const raw = JSON.stringify([
      {
        number: 1,
        title: 'PR',
        url: 'https://github.com/owner/repo/pull/1',
        headRefName: 'feat',
        author: { login: 'alice' },
        isDraft: false,
        state: 'OPEN',
        reviewDecision: null,
        statusCheckRollup: null,
        // no headRefOid
      },
    ]);
    const prs = await listOpenPrs('/repo', makeRunner(raw));
    expect(prs[0].headSha).toBeNull();
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

describe('fetchFailedLogs', () => {
  const FAILING_CHECKS = JSON.stringify([
    { name: 'Lint', state: 'FAILURE', link: 'https://github.com/owner/repo/actions/runs/111/jobs/999', bucket: 'fail' },
    { name: 'Type Check', state: 'FAILURE', link: 'https://github.com/owner/repo/actions/runs/111/jobs/998', bucket: 'fail' },
    { name: 'Build', state: 'FAILURE', link: 'https://github.com/owner/repo/actions/runs/222/jobs/997', bucket: 'fail' },
  ]);

  const NON_ACTIONS_CHECK = JSON.stringify([
    { name: 'Codecov', state: 'FAILURE', link: 'https://codecov.io/some/path', bucket: 'fail' },
  ]);

  const PASSING_CHECKS = JSON.stringify([
    { name: 'Lint', state: 'SUCCESS', link: null, bucket: 'pass' },
  ]);

  function makeSequentialRunner(responses: Record<string, string>): GhRunner {
    return async (args: string[]) => {
      const key = args.join(' ');
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.includes(pattern)) return { stdout: response, stderr: '' };
      }
      throw new Error(`Unexpected gh args: ${key}`);
    };
  }

  it('returns empty array when no checks fail (bucket not "fail")', async () => {
    const runner = makeRunner(PASSING_CHECKS);
    const logs = await fetchFailedLogs('/repo', 1, runner);
    expect(logs).toEqual([]);
  });

  it('groups failing checks by run ID and deduplicates log fetches', async () => {
    // run 111 has two failing checks (Lint + Type Check); run 222 has one (Build)
    const runner = makeSequentialRunner({
      'pr checks 1': FAILING_CHECKS,
      'run view 111': 'ESLint: 5 errors\ntsc: 2 errors',
      'run view 222': 'Build failed: exit 1',
    });

    const logs = await fetchFailedLogs('/repo', 1, runner);

    // 3 results total: 2 from run 111 (one per check name), 1 from run 222
    expect(logs).toHaveLength(3);
    const names = logs.map((l) => l.checkName).sort();
    expect(names).toEqual(['Build', 'Lint', 'Type Check']);

    const lint = logs.find((l) => l.checkName === 'Lint')!;
    const typecheck = logs.find((l) => l.checkName === 'Type Check')!;
    expect(lint.excerpt).toContain('ESLint');
    expect(typecheck.excerpt).toContain('ESLint');

    const build = logs.find((l) => l.checkName === 'Build')!;
    expect(build.excerpt).toContain('Build failed');
  });

  it('returns empty excerpt for non-Actions checks (link does not match actions/runs)', async () => {
    const runner = makeSequentialRunner({
      'pr checks 1': NON_ACTIONS_CHECK,
    });

    const logs = await fetchFailedLogs('/repo', 1, runner);

    expect(logs).toHaveLength(1);
    expect(logs[0].checkName).toBe('Codecov');
    expect(logs[0].excerpt).toBe('');
  });

  it('returns empty excerpt when run view fails, without throwing', async () => {
    const callLog: string[] = [];
    const runner: GhRunner = async (args) => {
      const key = args.join(' ');
      callLog.push(key);
      if (key.includes('pr checks')) {
        return { stdout: JSON.stringify([
          { name: 'Lint', state: 'FAILURE', link: 'https://github.com/owner/repo/actions/runs/333/jobs/1', bucket: 'fail' },
        ]), stderr: '' };
      }
      if (key.includes('run view 333')) {
        throw new Error('run not found');
      }
      throw new Error(`Unexpected: ${key}`);
    };

    const logs = await fetchFailedLogs('/repo', 1, runner);
    expect(logs).toHaveLength(1);
    expect(logs[0].checkName).toBe('Lint');
    expect(logs[0].excerpt).toBe('');
  });

  it('returns empty excerpt for a check with a null link', async () => {
    const raw = JSON.stringify([
      { name: 'Flaky Check', state: 'FAILURE', link: null, bucket: 'fail' },
    ]);
    const runner = makeRunner(raw);
    const logs = await fetchFailedLogs('/repo', 1, runner);
    expect(logs).toHaveLength(1);
    expect(logs[0].excerpt).toBe('');
  });

  describe('secret redaction in log excerpts', () => {
    function makeRunnerWithLog(log: string): GhRunner {
      return async (args) => {
        if (args.includes('checks')) {
          return {
            stdout: JSON.stringify([
              { name: 'CI', state: 'FAILURE', link: 'https://github.com/owner/repo/actions/runs/1/jobs/1', bucket: 'fail' },
            ]),
            stderr: '',
          };
        }
        return { stdout: log, stderr: '' };
      };
    }

    it('should redact GitHub PAT (ghp_) tokens from log excerpts', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('token=ghp_abcdefghijklmnopqrstu'));
      expect(logs[0].excerpt).toBe('token=[redacted]');
    });

    it('should redact GitHub OAuth (gho_) tokens', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('gho_abcdefghijklmnopqrstu1234'));
      expect(logs[0].excerpt).toContain('[redacted]');
      expect(logs[0].excerpt).not.toContain('gho_');
    });

    it('should redact fine-grained GitHub PATs (github_pat_)', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('github_pat_abc123def456ghi789jkl0'));
      expect(logs[0].excerpt).toContain('[redacted]');
      expect(logs[0].excerpt).not.toContain('github_pat_');
    });

    it('should redact AWS access key IDs (AKIA...)', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('key=AKIAIOSFODNN7EXAMPLE'));
      expect(logs[0].excerpt).toContain('[redacted]');
      expect(logs[0].excerpt).not.toContain('AKIAIOSFODNN7EXAMPLE');
    });

    it('should redact Bearer tokens', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('Authorization: Bearer mysecrettoken123abc'));
      expect(logs[0].excerpt).toContain('[redacted]');
      expect(logs[0].excerpt).not.toContain('mysecrettoken123abc');
    });

    it('should redact Slack tokens (xox...)', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('slack=xoxb-1234567890-abcdefghij'));
      expect(logs[0].excerpt).toContain('[redacted]');
      expect(logs[0].excerpt).not.toContain('xoxb-1234567890-abcdefghij');
    });

    it('should leave non-sensitive log content unchanged', async () => {
      const logs = await fetchFailedLogs('/repo', 1, makeRunnerWithLog('Error: cannot find module ./foo'));
      expect(logs[0].excerpt).toBe('Error: cannot find module ./foo');
    });
  });

  it('truncates very long log output to the tail', async () => {
    const longLine = 'x'.repeat(100);
    const manyLines = Array.from({ length: 300 }, (_, i) => `line ${i}: ${longLine}`).join('\n');

    const runner: GhRunner = async (args) => {
      if (args.includes('checks')) {
        return { stdout: JSON.stringify([
          { name: 'Test', state: 'FAILURE', link: 'https://github.com/owner/repo/actions/runs/444/jobs/1', bucket: 'fail' },
        ]), stderr: '' };
      }
      return { stdout: manyLines, stderr: '' };
    };

    const logs = await fetchFailedLogs('/repo', 1, runner);
    const lineCount = logs[0].excerpt.split('\n').filter(Boolean).length;
    expect(lineCount).toBeLessThanOrEqual(200);
    // Tail is preserved
    expect(logs[0].excerpt).toContain('line 299');
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

  it('returns not-authenticated when stderr says not logged into any host', async () => {
    const status = await checkAuthStatus(
      makeErrorRunner({
        message: 'Command failed: gh auth status',
        stderr: 'You are not logged into any GitHub hosts. Run `gh auth login` to authenticate.',
      }),
    );
    expect(status).toEqual({ ok: false, reason: 'not-authenticated' });
  });

  it('returns not-authenticated when stderr says not logged into a specific host', async () => {
    const status = await checkAuthStatus(
      makeErrorRunner({
        message: 'Command failed: gh auth status',
        stderr: 'github.com\n  X You are not logged into github.com',
      }),
    );
    expect(status).toEqual({ ok: false, reason: 'not-authenticated' });
  });

  it('returns not-authenticated when message mentions gh auth login guidance', async () => {
    const status = await checkAuthStatus(
      makeErrorRunner({ message: 'error: run gh auth login to continue' }),
    );
    expect(status).toEqual({ ok: false, reason: 'not-authenticated' });
  });

  it('throws for unexpected errors unrelated to authentication', async () => {
    const runner = makeErrorRunner({ message: 'connect ECONNREFUSED 127.0.0.1:443' });
    await expect(checkAuthStatus(runner)).rejects.toThrow('connect ECONNREFUSED 127.0.0.1:443');
  });

  it('throws for internal gh errors with no auth-related output', async () => {
    const runner = makeErrorRunner({ message: 'request timeout after 30s', stderr: 'fatal: internal error' });
    await expect(checkAuthStatus(runner)).rejects.toThrow('request timeout after 30s');
  });
});
