import { execFile } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type { GitFileStatus } from '@engy/common';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

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

function mapStatusCode(index: string, workingDir: string): { status: GitFileStatus; staged: boolean } {
  // Staged changes (index column)
  if (index === 'A') return { status: 'added', staged: true };
  if (index === 'M') return { status: 'modified', staged: true };
  if (index === 'D') return { status: 'deleted', staged: true };
  if (index === 'R') return { status: 'renamed', staged: true };

  // Unstaged changes (working directory column)
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

export async function getStatusDetailed(dir: string): Promise<DetailedStatus> {
  const git = simpleGit(dir);
  const status = await git.status();

  const files: DetailedFileStatus[] = status.files.map((f) => {
    const { status: fileStatus, staged } = mapStatusCode(f.index, f.working_dir.trim());
    return { path: f.path, status: fileStatus, staged };
  });

  return {
    files,
    branch: status.current ?? 'HEAD',
  };
}

async function isTracked(dir: string, filePath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', dir, 'ls-files', '--error-unmatch', filePath], {
      maxBuffer: EXEC_MAX_BUFFER,
    });
    return true;
  } catch {
    return false;
  }
}

async function getGitRoot(dir: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', dir, 'rev-parse', '--show-toplevel'],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
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
): Promise<string> {
  // filePath from git status is always relative to the git root, which may differ
  // from dir when dir is a subdirectory of the repo
  const root = await getGitRoot(dir);

  if (staged && !base) {
    // Staged file: compare index vs HEAD (--cached without HEAD works even in empty repos)
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'diff', '--cached', '--', filePath],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
    return stdout || diffAgainstEmpty(root, filePath);
  }

  // Unstaged or base-relative diff
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'diff', base ?? 'HEAD', '--', filePath],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
    if (stdout) return stdout;

    if (!base && !(await isTracked(root, filePath))) {
      return diffAgainstEmpty(root, filePath);
    }
    return '';
  } catch {
    // File might be untracked — show diff against empty
    return diffAgainstEmpty(root, filePath);
  }
}

async function diffAgainstEmpty(dir: string, filePath: string): Promise<string> {
  // Use absolute path so --no-index resolves correctly regardless of process CWD
  const absolutePath = isAbsolute(filePath) ? filePath : join(dir, filePath);
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-C', dir, 'diff', '--no-index', '/dev/null', absolutePath],
      { maxBuffer: EXEC_MAX_BUFFER },
    );
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
): Promise<Array<{ hash: string; message: string; author: string; date: string }>> {
  const git = simpleGit(dir);
  const log = await git.log({ maxCount });
  return log.all.map((entry) => ({
    hash: entry.hash,
    message: entry.message,
    author: entry.author_name,
    date: entry.date,
  }));
}

export async function getShow(
  dir: string,
  commitHash: string,
): Promise<{ diff: string; files: Array<{ path: string; status: GitFileStatus }> }> {
  const { stdout: diffOutput } = await execFileAsync(
    'git',
    ['-C', dir, 'show', '--format=', commitHash],
    { maxBuffer: EXEC_MAX_BUFFER },
  );

  const { stdout: nameStatusOutput } = await execFileAsync(
    'git',
    ['-C', dir, 'diff-tree', '--root', '--no-commit-id', '-r', '--name-status', commitHash],
    { maxBuffer: EXEC_MAX_BUFFER },
  );

  const files = parseNameStatusOutput(nameStatusOutput);
  return { diff: diffOutput, files };
}

export async function getBranchFiles(
  dir: string,
  base: string,
): Promise<Array<{ path: string; status: GitFileStatus }>> {
  const { stdout } = await execFileAsync(
    'git',
    ['-C', dir, 'diff', '--name-status', base],
    { maxBuffer: EXEC_MAX_BUFFER },
  );

  return parseNameStatusOutput(stdout);
}
