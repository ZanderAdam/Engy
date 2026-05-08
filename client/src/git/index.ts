import { execFile } from 'node:child_process';
import { join, isAbsolute, resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type { GitFileStatus, GitWorktreeEntry } from '@engy/common';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

export type GitRunner = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

export const localGitRunner: GitRunner = (args) =>
  execFileAsync('git', args, { maxBuffer: EXEC_MAX_BUFFER });

const GIT_STATUS_MAP: Record<string, GitFileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
};

interface BranchInfo {
  current: string;
  isDetached: boolean;
}

interface FileStatus {
  path: string;
  status: string;
}

interface DetailedFileStatus {
  path: string;
  status: GitFileStatus;
  staged: boolean;
}

interface DetailedStatus {
  files: DetailedFileStatus[];
  branch: string;
}

function mapStatusCode(
  index: string,
  workingDir: string,
): { status: GitFileStatus; staged: boolean } {
  if (index === 'A') return { status: 'added', staged: true };
  if (index === 'M') return { status: 'modified', staged: true };
  if (index === 'D') return { status: 'deleted', staged: true };
  if (index === 'R') return { status: 'renamed', staged: true };

  if (workingDir === 'M') return { status: 'modified', staged: false };
  if (workingDir === 'D') return { status: 'deleted', staged: false };
  if (workingDir === '?') return { status: 'added', staged: false };

  return { status: 'modified', staged: false };
}

function parseNameStatusOutput(
  output: string,
): Array<{ path: string; status: GitFileStatus }> {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split('\t');
      return {
        path: rest[rest.length - 1] ?? '',
        status: GIT_STATUS_MAP[code.charAt(0)] ?? 'modified',
      };
    });
}

export async function getBranchInfo(dir: string): Promise<BranchInfo> {
  const git = simpleGit(dir);
  const status = await git.status();
  return {
    current: status.current ?? 'HEAD',
    isDetached: status.detached,
  };
}

export async function getStatus(dir: string): Promise<FileStatus[]> {
  const git = simpleGit(dir);
  const status = await git.status();
  return status.files.map((f) => ({
    path: f.path,
    status: f.working_dir.trim() || f.index,
  }));
}

interface ParsedPorcelainStatus {
  branch: string;
  entries: Array<{ index: string; workingDir: string; path: string }>;
}

export function parsePorcelainStatus(output: string): ParsedPorcelainStatus {
  // Format from `git status --porcelain=v1 -b -z`: NUL-separated tokens.
  // First token: `## <branch>...<remote> [ahead N, behind M]` (or `## HEAD (no branch)`).
  // Remaining tokens: `XY <path>`. Renames add an extra NUL-separated old path.
  const tokens = output.split('\0');
  let branch = 'HEAD';
  const entries: Array<{ index: string; workingDir: string; path: string }> = [];

  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (!tok) {
      i++;
      continue;
    }
    if (tok.startsWith('## ')) {
      const rest = tok.slice(3);
      if (rest.startsWith('HEAD (no branch)')) {
        branch = 'HEAD';
      } else {
        branch = rest.split(/\.\.\.| /)[0] ?? 'HEAD';
      }
      i++;
      continue;
    }

    const xy = tok.slice(0, 2);
    const path = tok.slice(3);
    const index = xy[0];
    const workingDir = xy[1];
    entries.push({ index, workingDir, path });
    if (index === 'R' || index === 'C') {
      // Rename/copy entry: skip the original-path token
      i += 2;
    } else {
      i++;
    }
  }

  return { branch, entries };
}

export async function getStatusDetailed(
  dir: string,
  runGit: GitRunner = localGitRunner,
): Promise<DetailedStatus> {
  const { stdout } = await runGit(['-C', dir, 'status', '--porcelain=v1', '-b', '-z']);
  const { branch, entries } = parsePorcelainStatus(stdout);

  const files: DetailedFileStatus[] = entries.map((e) => {
    const { status, staged } = mapStatusCode(e.index, e.workingDir.trim());
    return { path: e.path, status, staged };
  });

  return { files, branch };
}

async function isTracked(
  dir: string,
  filePath: string,
  runGit: GitRunner,
): Promise<boolean> {
  try {
    await runGit(['-C', dir, 'ls-files', '--error-unmatch', filePath]);
    return true;
  } catch {
    return false;
  }
}

async function getGitRoot(dir: string, runGit: GitRunner): Promise<string> {
  try {
    const { stdout } = await runGit(['-C', dir, 'rev-parse', '--show-toplevel']);
    return stdout.trim();
  } catch {
    return dir;
  }
}

export async function getDiff(
  dir: string,
  filePath: string,
  base?: string,
  staged?: boolean,
  runGit: GitRunner = localGitRunner,
): Promise<string> {
  // filePath from git status is always relative to the git root, which may differ
  // from dir when dir is a subdirectory of the repo
  const root = await getGitRoot(dir, runGit);

  if (staged && !base) {
    const { stdout } = await runGit(['-C', root, 'diff', '--cached', '--', filePath]);
    return stdout || diffAgainstEmpty(root, filePath, runGit);
  }

  try {
    const { stdout } = await runGit(['-C', root, 'diff', base ?? 'HEAD', '--', filePath]);
    if (stdout) return stdout;

    if (!base && !(await isTracked(root, filePath, runGit))) {
      return diffAgainstEmpty(root, filePath, runGit);
    }
    return '';
  } catch {
    return diffAgainstEmpty(root, filePath, runGit);
  }
}

async function diffAgainstEmpty(
  dir: string,
  filePath: string,
  runGit: GitRunner,
): Promise<string> {
  const absolutePath = isAbsolute(filePath) ? filePath : join(dir, filePath);
  try {
    const { stdout } = await runGit(['-C', dir, 'diff', '--no-index', '/dev/null', absolutePath]);
    return stdout;
  } catch (e: unknown) {
    // git diff --no-index exits with code 1 when files differ
    const stdout = (e as { stdout?: string })?.stdout;
    return typeof stdout === 'string' ? stdout : '';
  }
}

export async function getLog(
  dir: string,
  maxCount = 50,
  runGit: GitRunner = localGitRunner,
): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
  // Format: hash\0author\0iso-date\0subject  (one record per line)
  const { stdout } = await runGit([
    '-C',
    dir,
    'log',
    '--no-color',
    '--pretty=format:%H%x00%an%x00%aI%x00%s',
    '-n',
    String(maxCount),
  ]);

  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, date, ...messageParts] = line.split('\0');
      return {
        hash: hash ?? '',
        author: author ?? '',
        date: date ?? '',
        message: messageParts.join('\0'),
      };
    });
}

export async function getShow(
  dir: string,
  commitHash: string,
  runGit: GitRunner = localGitRunner,
): Promise<{ diff: string; files: Array<{ path: string; status: GitFileStatus }> }> {
  const { stdout: diffOutput } = await runGit([
    '-C',
    dir,
    'show',
    '--format=',
    commitHash,
  ]);

  const { stdout: nameStatusOutput } = await runGit([
    '-C',
    dir,
    'diff-tree',
    '--root',
    '--no-commit-id',
    '-r',
    '--name-status',
    commitHash,
  ]);

  const files = parseNameStatusOutput(nameStatusOutput);
  return { diff: diffOutput, files };
}

export async function getBranchFiles(
  dir: string,
  base: string,
  runGit: GitRunner = localGitRunner,
): Promise<Array<{ path: string; status: GitFileStatus }>> {
  const { stdout } = await runGit(['-C', dir, 'diff', '--name-status', base]);
  return parseNameStatusOutput(stdout);
}

export function parseWorktreeList(output: string): GitWorktreeEntry[] {
  // `git worktree list --porcelain` emits blocks separated by blank lines.
  // Each block has lines like:
  //   worktree <abs path>
  //   HEAD <sha>
  //   branch refs/heads/<name>     (omitted for detached)
  //   detached                     (instead of branch when HEAD is detached)
  //   bare                         (for the bare main entry, no HEAD/branch)
  //   locked [reason]              (optional)
  // The first block is the main worktree.
  const entries: GitWorktreeEntry[] = [];
  const blocks = output.split('\n\n').filter((b) => b.trim().length > 0);

  blocks.forEach((block, idx) => {
    const lines = block.split('\n');
    let path: string | undefined;
    let branch: string | null = null;
    let isLocked = false;

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length);
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
      } else if (line === 'locked' || line.startsWith('locked ')) {
        isLocked = true;
      }
    }

    if (path) {
      entries.push({ path, branch, isMain: idx === 0, isLocked });
    }
  });

  return entries;
}

export async function listWorktrees(
  repoDir: string,
  runGit: GitRunner = localGitRunner,
): Promise<GitWorktreeEntry[]> {
  const { stdout } = await runGit(['-C', repoDir, 'worktree', 'list', '--porcelain']);
  return parseWorktreeList(stdout);
}

function resolveAndValidatePath(dir: string, filePath: string): string {
  const fullPath = isAbsolute(filePath) ? filePath : resolve(dir, filePath);
  const resolvedDir = resolve(dir);
  if (!fullPath.startsWith(resolvedDir + '/') && fullPath !== resolvedDir) {
    throw new Error(`Path traversal detected: ${filePath} resolves outside ${dir}`);
  }
  return fullPath;
}

export async function getFileContent(
  dir: string,
  filePath: string,
  ref?: string,
  runGit: GitRunner = localGitRunner,
): Promise<string> {
  if (ref) {
    const root = await getGitRoot(dir, runGit);
    const { stdout } = await runGit(['-C', root, 'show', `${ref}:${filePath}`]);
    return stdout;
  }
  const fullPath = resolveAndValidatePath(dir, filePath);
  return readFile(fullPath, 'utf-8');
}

export async function writeFileContent(
  dir: string,
  filePath: string,
  content: string,
): Promise<void> {
  const fullPath = resolveAndValidatePath(dir, filePath);
  await writeFile(fullPath, content, 'utf-8');
}
