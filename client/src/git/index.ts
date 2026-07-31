import { execFile } from 'node:child_process';
import { join, isAbsolute, resolve } from 'node:path';
import { readFile, writeFile, readdir, stat, lstat } from 'node:fs/promises';
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
  C: 'renamed',
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
  contentId?: string;
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
): Array<{ path: string; status: GitFileStatus; oldPath?: string }> {
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [code, ...rest] = line.split('\t');
      const statusChar = code.charAt(0);
      const path = rest[rest.length - 1] ?? '';
      const status = GIT_STATUS_MAP[statusChar] ?? 'modified';
      // Renames/copies list two paths: `R<score>\told\tnew`
      if ((statusChar === 'R' || statusChar === 'C') && rest.length >= 2) {
        return { path, status, oldPath: rest[0] };
      }
      return { path, status };
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
      } else if (rest.startsWith('No commits yet on ')) {
        branch = rest.slice('No commits yet on '.length).split(/\.\.\.| /)[0] ?? 'HEAD';
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

  const parsed: DetailedFileStatus[] = entries.map((e) => {
    const { status, staged } = mapStatusCode(e.index, e.workingDir.trim());
    return { path: e.path, status, staged };
  });

  return { files: await withContentIds(dir, parsed), branch };
}

/**
 * Opaque identifier for a path's current on-disk state, used to tell whether a
 * file still holds what the user reviewed. Size plus mtime rather than a content
 * hash: `git hash-object` dereferences symlinks (hashing the target instead of
 * the link), aborts an entire batch on directories and submodule gitlinks, and
 * costs a process spawn per listing. `lstat` describes the path itself, handles
 * every entry type, and needs no subprocess.
 *
 * A file touched without its bytes changing gets a new id and so loses its
 * viewed mark. That is the safe direction to be wrong in: re-reviewing an
 * unchanged file costs a click, whereas a mark that fails to expire hides real
 * changes.
 */
async function fileIdentity(dir: string, path: string): Promise<string | undefined> {
  try {
    const info = await lstat(resolve(dir, path));
    // Directories reach here as untracked-directory entries (`dir/` from
    // porcelain) and as submodule gitlinks; neither has content of its own.
    if (info.isDirectory()) return undefined;
    return `${info.size}:${info.mtimeMs}`;
  } catch {
    // Not on disk — deleted, or a dangling entry.
    return undefined;
  }
}

async function withContentIds<T extends { path: string; status: GitFileStatus }>(
  dir: string,
  files: T[],
): Promise<Array<T & { contentId?: string }>> {
  return Promise.all(
    files.map(async (file) => ({
      ...file,
      contentId: file.status === 'deleted' ? undefined : await fileIdentity(dir, file.path),
    })),
  );
}

async function isTracked(dir: string, filePath: string, runGit: GitRunner): Promise<boolean> {
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

// Probed in order when `refs/remotes/origin/HEAD` is absent, which is the common
// case: git only writes that ref at clone time, so repos created with `git init`
// or migrated between remotes never have it.
const DEFAULT_BASE_CANDIDATES = [
  'origin/main',
  'origin/master',
  'origin/develop',
  'main',
  'master',
];

async function refExists(dir: string, ref: string, runGit: GitRunner): Promise<boolean> {
  try {
    await runGit(['-C', dir, 'rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

export async function resolveDefaultBase(
  dir: string,
  runGit: GitRunner = localGitRunner,
): Promise<string> {
  try {
    const { stdout } = await runGit([
      '-C',
      dir,
      'symbolic-ref',
      '--short',
      'refs/remotes/origin/HEAD',
    ]);
    // Validate before trusting it: origin/HEAD survives the remote's default
    // branch being renamed or deleted, and a dead ref here would pre-fill the
    // UI with a base that cannot be diffed.
    const recorded = stdout.trim();
    if (recorded && (await refExists(dir, recorded, runGit))) return recorded;
  } catch {
    // Not set — fall through to probing.
  }

  for (const candidate of DEFAULT_BASE_CANDIDATES) {
    if (await refExists(dir, candidate, runGit)) return candidate;
  }

  try {
    const { stdout } = await runGit(['-C', dir, 'rev-parse', '--abbrev-ref', 'HEAD']);
    return stdout.trim() || 'HEAD';
  } catch {
    return 'HEAD';
  }
}

// `git diff <base>` compares base's *tip* to the working tree, so every commit
// landed on base since the branch forked shows up as an inverted change. Diffing
// against the merge base instead yields only what this branch did — while still
// including uncommitted work, which `<base>...HEAD` would drop.
async function resolveMergeBase(dir: string, base: string, runGit: GitRunner): Promise<string> {
  try {
    const { stdout } = await runGit(['-C', dir, 'merge-base', base, 'HEAD']);
    const sha = stdout.trim();
    if (sha) return sha;
  } catch {
    // `merge-base` fails both for a base that does not resolve and for one that
    // resolves but shares no ancestor with HEAD. Returning `base` covers both:
    // an unresolvable ref makes the diff below throw (surfaced as a bad-ref
    // error), while unrelated histories fall back to a plain base-tip diff,
    // which is the only computable answer when there is no fork point.
  }
  return base;
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

async function diffAgainstEmpty(dir: string, filePath: string, runGit: GitRunner): Promise<string> {
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
): Promise<{ files: Array<{ path: string; status: GitFileStatus; oldPath?: string }> }> {
  // `diff-tree <hash>` prints nothing for merge commits, so diff against the
  // first parent explicitly (GitHub behavior). Root commits have no parent —
  // fall back to `--root`.
  let hasParent = true;
  try {
    await runGit(['-C', dir, 'rev-parse', '--verify', '--quiet', `${commitHash}^1`]);
  } catch {
    hasParent = false;
  }

  const refArgs = hasParent ? [`${commitHash}^1`, commitHash] : ['--root', commitHash];
  const { stdout } = await runGit([
    '-C',
    dir,
    'diff-tree',
    '--no-commit-id',
    '-r',
    '-M',
    '--name-status',
    ...refArgs,
  ]);

  return { files: parseNameStatusOutput(stdout) };
}

/**
 * Untracked files that git is not ignoring. `git diff` only ever reports
 * tracked paths, so without this a brand-new file is invisible in a branch
 * diff even though `Latest Changes` (porcelain status) lists it.
 * `--exclude-standard` applies .gitignore/.git/info/exclude, keeping build
 * output and node_modules out; `--full-name` makes the paths repo-root
 * relative so they line up with the diff output.
 */
async function getUntrackedFiles(dir: string, runGit: GitRunner): Promise<string[]> {
  const { stdout } = await runGit([
    '-C',
    dir,
    'ls-files',
    '--others',
    '--exclude-standard',
    '--full-name',
    '-z',
  ]);
  return stdout.split('\0').filter(Boolean);
}

export async function getBranchFiles(
  dir: string,
  base: string,
  runGit: GitRunner = localGitRunner,
): Promise<{
  files: Array<{ path: string; status: GitFileStatus; oldPath?: string; contentId?: string }>;
  mergeBase: string;
}> {
  const mergeBase = await resolveMergeBase(dir, base, runGit);
  // `-M` matches getShow, so branch diffs report renames rather than add+delete pairs.
  const [{ stdout }, untracked] = await Promise.all([
    runGit(['-C', dir, 'diff', '--name-status', '-M', mergeBase]),
    getUntrackedFiles(dir, runGit),
  ]);

  const files = parseNameStatusOutput(stdout);
  // A path can appear in both lists after `git rm --cached`: the diff reports it
  // deleted while it survives on disk as untracked. The diff entry wins — losing
  // tracking is the change relative to the base — so it is not re-added here.
  const seen = new Set(files.map((f) => f.path));
  for (const path of untracked) {
    if (!seen.has(path)) files.push({ path, status: 'added' });
  }

  return { files: await withContentIds(dir, files), mergeBase };
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

/**
 * Read raw file bytes — from a git ref (`git show <ref>:<path>`, captured as a
 * Buffer so binary content is preserved) or from the working tree. The binary
 * counterpart to getFileContent, used for image previews in the code/diff
 * viewers. Coder (remote) reads are handled by the daemon's WS handler instead.
 *
 * `maxBytes` caps the read so a huge file can't spike the daemon heap: the ref
 * path is bounded by execFile's maxBuffer, the working-tree path by an upfront
 * stat. Like getFileContent's ref branch, `git show` resolves `filePath`
 * against the repo tree (not the FS), so traversal is inert there; the
 * working-tree branch still goes through resolveAndValidatePath.
 */
export async function getFileBytes(
  dir: string,
  filePath: string,
  ref?: string,
  maxBytes = EXEC_MAX_BUFFER,
): Promise<Buffer> {
  if (ref) {
    const root = await getGitRoot(dir, localGitRunner);
    const { stdout } = await execFileAsync('git', ['-C', root, 'show', `${ref}:${filePath}`], {
      encoding: 'buffer',
      maxBuffer: maxBytes,
    });
    return stdout;
  }
  const fullPath = resolveAndValidatePath(dir, filePath);
  const { size } = await stat(fullPath);
  if (size > maxBytes) {
    throw new Error(`File too large to read (${size} bytes, max ${maxBytes})`);
  }
  return readFile(fullPath);
}

export async function writeFileContent(
  dir: string,
  filePath: string,
  content: string,
): Promise<void> {
  const fullPath = resolveAndValidatePath(dir, filePath);
  await writeFile(fullPath, content, 'utf-8');
}

const GLOB_SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '__pycache__']);
const GLOB_MAX_READDIR_DEPTH = 10;

async function listDirFilesRecursiveForGlob(
  rootDir: string,
  currentDir: string,
  depth: number,
): Promise<string[]> {
  if (depth <= 0) return [];
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || GLOB_SKIP_DIRS.has(entry.name)) continue;
    const fullPath = join(currentDir, entry.name);
    if (entry.isFile()) {
      files.push(fullPath);
    } else if (entry.isDirectory()) {
      files.push(...(await listDirFilesRecursiveForGlob(rootDir, fullPath, depth - 1)));
    }
  }
  return files;
}

function matchesPatterns(filePath: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    // Patterns like '*.test.ts' — match by suffix
    const suffix = pattern.startsWith('*') ? pattern.slice(1) : pattern;
    return filePath.endsWith(suffix);
  });
}

async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['-C', dir, 'rev-parse', '--git-dir'], {
      maxBuffer: EXEC_MAX_BUFFER,
    });
    return true;
  } catch {
    return false;
  }
}

export async function globTestFiles(repoDir: string, patterns: string[]): Promise<string[]> {
  if (await isGitRepo(repoDir)) {
    const args = [
      '-C',
      repoDir,
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      ...patterns,
    ];
    const { stdout } = await execFileAsync('git', args, { maxBuffer: EXEC_MAX_BUFFER });
    return stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => join(repoDir, line));
  }

  // Non-git directory: recursive readdir fallback, filter by pattern suffixes
  const allFiles = await listDirFilesRecursiveForGlob(repoDir, repoDir, GLOB_MAX_READDIR_DEPTH);
  return allFiles.filter((filePath) => matchesPatterns(filePath, patterns));
}
