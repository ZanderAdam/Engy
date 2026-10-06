import type { AppState } from '../trpc/context';
import { isFailingCheck, type FailedLog } from '../pr/ci-triage';
import { githubRest } from './client';
import { redactSecrets } from './errors';

interface RawCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
  details_url: string | null;
}

const ACTIONS_JOB_RE = /\/actions\/runs\/\d+\/job\/(\d+)/;
const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 16 * 1024;

function truncateTail(log: string): string {
  const buf = Buffer.from(log, 'utf-8');
  let trimmed = log;
  if (buf.length > MAX_LOG_BYTES) {
    const tail = buf.slice(buf.length - MAX_LOG_BYTES).toString('utf-8');
    const firstNewline = tail.indexOf('\n');
    trimmed = firstNewline !== -1 ? tail.slice(firstNewline + 1) : tail;
  }
  const lines = trimmed.split('\n');
  return lines.length > MAX_LOG_LINES ? lines.slice(-MAX_LOG_LINES).join('\n') : trimmed;
}

async function fetchJobLog(state: AppState, repoFullName: string, jobId: string): Promise<string> {
  try {
    const result = await githubRest<unknown>(
      state,
      `/repos/${repoFullName}/actions/jobs/${jobId}/logs`,
    );
    if (result.status === 'not_modified' || typeof result.data !== 'string') return '';
    return redactSecrets(truncateTail(result.data));
  } catch {
    return '';
  }
}

export async function fetchFailedLogs(
  state: AppState,
  repoFullName: string,
  headSha: string,
): Promise<FailedLog[]> {
  const result = await githubRest<{ check_runs: RawCheckRun[] }>(
    state,
    `/repos/${repoFullName}/commits/${headSha}/check-runs?filter=latest&per_page=100`,
  );
  if (result.status === 'not_modified') return [];

  const failing = result.data.check_runs.filter((run) =>
    isFailingCheck({
      name: run.name,
      status: run.status,
      conclusion: run.conclusion,
      detailsUrl: run.details_url,
    }),
  );

  return Promise.all(
    failing.map(async (run) => {
      const jobId = run.details_url ? ACTIONS_JOB_RE.exec(run.details_url)?.[1] : undefined;
      const excerpt = jobId ? await fetchJobLog(state, repoFullName, jobId) : '';
      return { checkName: run.name, excerpt };
    }),
  );
}
