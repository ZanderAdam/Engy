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
  headRefOid: string;
  author: { login: string };
  isDraft: boolean;
  state: string;
  reviewDecision: string | null;
  statusCheckRollup: RawStatusCheckEntry[] | null;
}

interface RawPrCheck {
  name: string;
  state: string;
  link: string | null;
  bucket: string;
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
  'number,title,url,headRefName,headRefOid,author,isDraft,state,reviewDecision,statusCheckRollup';

export async function listOpenPrs(repoDir: string, runner: GhRunner = localGhRunner): Promise<GhPr[]> {
  const { stdout } = await runner(['pr', 'list', '--json', PR_LIST_FIELDS], repoDir);
  const raw: RawPr[] = JSON.parse(stdout);
  return raw.map((pr) => ({
    number: pr.number,
    title: pr.title,
    url: pr.url,
    headBranch: pr.headRefName,
    headSha: pr.headRefOid ?? null,
    author: pr.author.login,
    isDraft: pr.isDraft,
    state: pr.state,
    reviewDecision: pr.reviewDecision ?? null,
    ciStatus: deriveCiStatus(pr.statusCheckRollup),
    checks: (pr.statusCheckRollup ?? []).map(normalizeCheck),
  }));
}

const ACTIONS_RUN_RE = /\/actions\/runs\/(\d+)/;
const MAX_LOG_LINES = 200;
const MAX_LOG_BYTES = 16 * 1024;

// Patterns for common secret formats. Prompts may still contain unredacted CI log
// content by design — this pass only strips obvious token strings.
const SECRET_PATTERNS: RegExp[] = [
  /ghp_[A-Za-z0-9]{20,}/g,
  /gho_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/g,
  /xox[a-z]-[A-Za-z0-9\-]{10,}/g,
];

function redactSecrets(text: string): string {
  let result = text;
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, '[redacted]');
  }
  return result;
}

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

export async function fetchFailedLogs(
  repoDir: string,
  prNumber: number,
  runner: GhRunner = localGhRunner,
): Promise<Array<{ checkName: string; excerpt: string }>> {
  const { stdout } = await runner(
    ['pr', 'checks', String(prNumber), '--json', 'name,state,link,bucket'],
    repoDir,
  );
  const checks: RawPrCheck[] = JSON.parse(stdout);

  const failingChecks = checks.filter((c) => c.bucket === 'fail');
  if (failingChecks.length === 0) return [];

  // Group failing checks by Actions run ID; non-Actions checks get an empty excerpt.
  const runIdToCheckNames = new Map<string, string[]>();
  const results: Array<{ checkName: string; excerpt: string }> = [];

  for (const check of failingChecks) {
    const match = check.link ? ACTIONS_RUN_RE.exec(check.link) : null;
    if (!match) {
      results.push({ checkName: check.name, excerpt: '' });
      continue;
    }
    const runId = match[1];
    if (!runIdToCheckNames.has(runId)) {
      runIdToCheckNames.set(runId, []);
    }
    runIdToCheckNames.get(runId)!.push(check.name);
  }

  for (const [runId, checkNames] of runIdToCheckNames) {
    let excerpt = '';
    try {
      const { stdout: logOutput } = await runner(['run', 'view', runId, '--log-failed'], repoDir);
      excerpt = redactSecrets(truncateTail(logOutput));
    } catch {
      // Non-fatal: skip log fetch for this run gracefully
    }
    for (const checkName of checkNames) {
      results.push({ checkName, excerpt });
    }
  }

  return results;
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
