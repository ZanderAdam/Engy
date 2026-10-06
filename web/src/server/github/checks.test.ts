import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { fetchFailedLogs } from './checks';
import { startStubGithub, type StubGithub } from './stub-server';

const jobUrl = (jobId: number) => `https://github.com/org/repo/actions/runs/9/job/${jobId}`;

const checkRun = (name: string, conclusion: string | null, detailsUrl: string | null) => ({
  name,
  status: conclusion ? 'completed' : 'in_progress',
  conclusion,
  details_url: detailsUrl,
});

describe('github failed check logs', () => {
  let stub: StubGithub;
  let state: AppState;

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  function replyWith(checkRuns: unknown[], logs: Record<string, string | number> = {}): void {
    stub.reply((request) => {
      if (request.url.includes('/check-runs')) return { body: { check_runs: checkRuns } };
      const jobId = /jobs\/(\d+)\/logs/.exec(request.url)?.[1] ?? '';
      const log = logs[jobId];
      if (typeof log === 'number') return { status: log, body: { message: 'gone' } };
      return { body: log ?? '' };
    });
  }

  it('[FR-PRMON-080] should return the log of each failing Actions job', async () => {
    replyWith(
      [
        checkRun('lint', 'failure', jobUrl(11)),
        checkRun('test', 'success', jobUrl(12)),
        checkRun('build', 'timed_out', jobUrl(13)),
        checkRun('deploy', null, jobUrl(14)),
      ],
      { '11': 'lint exploded', '13': 'build timed out' },
    );

    const logs = await fetchFailedLogs(state, 'org/repo', 'sha1');

    expect(logs).toEqual([
      { checkName: 'lint', excerpt: 'lint exploded' },
      { checkName: 'build', excerpt: 'build timed out' },
    ]);
    expect(stub.requests[0].url).toContain('/repos/org/repo/commits/sha1/check-runs');
  });

  it('[FR-PRMON-080] should give an empty excerpt to failing checks outside Actions', async () => {
    replyWith([checkRun('ci/external', 'failure', 'https://ci.example.com/build/5')]);

    const logs = await fetchFailedLogs(state, 'org/repo', 'sha1');

    expect(logs).toEqual([{ checkName: 'ci/external', excerpt: '' }]);
  });

  it('[FR-PRMON-080] should keep the check with an empty excerpt when its log download fails', async () => {
    replyWith([checkRun('lint', 'failure', jobUrl(11))], { '11': 404 });

    const logs = await fetchFailedLogs(state, 'org/repo', 'sha1');

    expect(logs).toEqual([{ checkName: 'lint', excerpt: '' }]);
  });

  it('[FR-PRMON-080] should keep the last 200 lines of a long log', async () => {
    const lines = Array.from({ length: 500 }, (_, i) => `line ${i}`);
    replyWith([checkRun('lint', 'failure', jobUrl(11))], { '11': lines.join('\n') });

    const [log] = await fetchFailedLogs(state, 'org/repo', 'sha1');

    const kept = log.excerpt.split('\n');
    expect(kept).toHaveLength(200);
    expect(kept[199]).toBe('line 499');
  });

  it('[FR-PRMON-080] should keep at most 16KB of a log, cutting at a line start', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `${i}:${'x'.repeat(498)}`);
    replyWith([checkRun('lint', 'failure', jobUrl(11))], { '11': lines.join('\n') });

    const [log] = await fetchFailedLogs(state, 'org/repo', 'sha1');

    expect(Buffer.byteLength(log.excerpt)).toBeLessThanOrEqual(16 * 1024);
    expect(log.excerpt.endsWith(`99:${'x'.repeat(498)}`)).toBe(true);
    expect(/^\d+:/.test(log.excerpt)).toBe(true);
  });

  it('[FR-PRMON-080] should redact secrets from logs', async () => {
    replyWith([checkRun('lint', 'failure', jobUrl(11))], {
      '11': 'token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked',
    });

    const [log] = await fetchFailedLogs(state, 'org/repo', 'sha1');

    expect(log.excerpt).toBe('token [redacted] leaked');
  });
});
