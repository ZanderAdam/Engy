import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GhPr, GhPrCheck, GhPrCiStatus, GhAuthStatus } from '@engy/common';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

export type GhRunner = (args: string[], cwd?: string) => Promise<{ stdout: string; stderr: string }>;

export const localGhRunner: GhRunner = (args, cwd) =>
  execFileAsync('gh', args, { maxBuffer: EXEC_MAX_BUFFER, ...(cwd ? { cwd } : {}) });

interface RawCheckRun {
  __typename: 'CheckRun';
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string | null;
}

interface RawStatusContext {
  __typename: 'StatusContext';
  context: string;
  state: string;
  targetUrl: string | null;
}

type RawStatusCheckEntry = RawCheckRun | RawStatusContext;

interface RawPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  author: { login: string };
  isDraft: boolean;
  state: string;
  reviewDecision: string | null;
  statusCheckRollup: RawStatusCheckEntry[] | null;
}

const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'action_required',
  'cancelled',
  'startup_failure',
]);

function deriveCiStatus(rollup: RawStatusCheckEntry[] | null): GhPrCiStatus {
  if (!rollup || rollup.length === 0) return 'unknown';

  let hasPending = false;

  for (const entry of rollup) {
    if (entry.__typename === 'CheckRun') {
      const conclusion = entry.conclusion?.toLowerCase() ?? null;
      const status = entry.status.toLowerCase();

      if (conclusion && FAILING_CONCLUSIONS.has(conclusion)) return 'failing';
      if (status === 'in_progress' || status === 'queued' || status === 'pending') {
        hasPending = true;
      }
    } else {
      const state = entry.state.toUpperCase();
      if (state === 'FAILURE' || state === 'ERROR') return 'failing';
      if (state === 'PENDING') hasPending = true;
    }
  }

  return hasPending ? 'pending' : 'passing';
}

function normalizeCheck(entry: RawStatusCheckEntry): GhPrCheck {
  if (entry.__typename === 'CheckRun') {
    return {
      name: entry.name,
      status: entry.status,
      conclusion: entry.conclusion ?? null,
      detailsUrl: entry.detailsUrl ?? null,
    };
  }
  return {
    name: entry.context,
    status: entry.state,
    conclusion: null,
    detailsUrl: entry.targetUrl ?? null,
  };
}

const PR_LIST_FIELDS =
  'number,title,url,headRefName,author,isDraft,state,reviewDecision,statusCheckRollup';

export async function listOpenPrs(repoDir: string, runner: GhRunner = localGhRunner): Promise<GhPr[]> {
  const { stdout } = await runner(['pr', 'list', '--json', PR_LIST_FIELDS], repoDir);
  const raw: RawPr[] = JSON.parse(stdout);
  return raw.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headBranch: pr.headRefName,
    author: pr.author.login,
    isDraft: pr.isDraft,
    state: pr.state,
    reviewDecision: pr.reviewDecision ?? null,
    ciStatus: deriveCiStatus(pr.statusCheckRollup),
    checks: (pr.statusCheckRollup ?? []).map(normalizeCheck),
  }));
}

export async function checkAuthStatus(runner: GhRunner = localGhRunner): Promise<GhAuthStatus> {
  try {
    await runner(['auth', 'status']);
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: false, reason: 'not-installed' };

    // `gh auth status` exits non-zero when the user is not logged in. Confirm
    // by matching known auth-problem phrases before classifying — anything else
    // is an unexpected error (network timeout, internal gh error, etc.) and
    // should propagate so callers can surface the real cause.
    const stderr = (err as { stderr?: string }).stderr ?? '';
    const combined = (stderr + '\n' + (err as Error).message).toLowerCase();
    if (
      combined.includes('not logged in') ||
      combined.includes('not logged into') ||
      combined.includes('gh auth login') ||
      combined.includes('run gh auth')
    ) {
      return { ok: false, reason: 'not-authenticated' };
    }

    throw err;
  }
}
