import { execFile } from 'node:child_process';
import { join, isAbsolute, resolve } from 'node:path';
import { readFile, writeFile, readdir, stat, lstat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { simpleGit } from 'simple-git';
import type { BranchDiffTarget, GitFileStatus, GitWorktreeEntry } from '@engy/common';

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

export interface GitRunOptions {
  /** Kill the process after this long. Used for calls that reach the network. */
  timeoutMs?: number;
}

export type GitRunner = (
  args: string[],
  options?: GitRunOptions,
) => Promise<{ stdout: string; stderr: string }>;

export const localGitRunner: GitRunner = (args, options) =>
  execFileAsync('git', args, {
    maxBuffer: EXEC_MAX_BUFFER,
    // The daemon is non-interactive: without this a remote needing credentials
    // parks git on a prompt forever, and killing the promise would orphan it.
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    ...(options?.timeoutMs ? { timeout: options.timeoutMs, killSignal: 'SIGKILL' as const } : {}),
  });

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
  oldPath?: string;
  contentId?: string;
  indexId?: string;
}

interface DetailedStatus {
  files: DetailedFileStatus[];
  branch: string;
  head?: string;
}

/**
 * The full set of unmerged two-letter codes. A conflicted path has no stage-0
 * index entry, so nothing can read it as "the staged version" — it must never
 * become a staged row. `AA` and `DD` carry no `U` at all, which is why the set
 * is matched whole rather than by looking for a `U` in either column.
 */
const UNMERGED_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * Porcelain reports two independent codes per path: what the index holds
 * relative to HEAD, and what the working tree holds relative to the index. Those
 * are two different diffs against two different bases, so a path changed on both
 * sides becomes two rows rather than one row labelled with whichever side won.
 *
 * A column holding a space means that side is unchanged. Which side a row
 * belongs to therefore comes from which column is occupied, never from whether
 * the code has a known status — an unrecognised code (a type change, say) still
 * belongs to the side that reported it.
 */
export function expandStatusEntry(
  index: string,
  workingDir: string,
): Array<{ status: GitFileStatus; staged: boolean }> {
  // Untracked paths have no index side to compare against.
  if (index === '?') return [{ status: 'added', staged: false }];
  // The resolution an unmerged path is waiting for lives in the working tree.
  if (UNMERGED_CODES.has(index + workingDir)) {
    return [{ status: 'modified', staged: false }];
  }

  const rows: Array<{ status: GitFileStatus; staged: boolean }> = [];
  if (index !== ' ') rows.push({ status: GIT_STATUS_MAP[index] ?? 'modified', staged: true });
  if (workingDir !== ' ') {
    rows.push({ status: GIT_STATUS_MAP[workingDir] ?? 'modified', staged: false });
  }

  // Neither column occupied should not reach here, but a path git bothered to
  // report is worth showing rather than dropping.
  if (rows.length === 0) rows.push({ status: 'modified', staged: false });
  return rows;
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
  entries: Array<{ index: string; workingDir: string; path: string; origPath?: string }>;
}

export function parsePorcelainStatus(output: string): ParsedPorcelainStatus {
  // Format from `git status --porcelain=v1 -b -z`: NUL-separated tokens.
  // First token: `## <branch>...<remote> [ahead N, behind M]` (or `## HEAD (no branch)`).
  // Remaining tokens: `XY <path>`. Renames add an extra NUL-separated old path.
  const tokens = output.split('\0');
  let branch = 'HEAD';
  const entries: ParsedPorcelainStatus['entries'] = [];

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
    // Rename/copy entries carry the pre-rename path in a second token. It is
    // where the file's "before" content still lives, so it is kept, not skipped.
    // A truncated stream leaves that token empty — `-z` always ends with a NUL,
    // so the split's final element is never a real path — and the entry is
    // still worth reporting as a plain status.
    const origPath = tokens[i + 1];
    const isRename = (index === 'R' || index === 'C') && !!origPath;
    entries.push({ index, workingDir, path, ...(isRename ? { origPath } : {}) });
    i += isRename ? 2 : 1;
  }

  return { branch, entries };
}

/**
 * Commit HEAD points at, so callers can name it instead of the moving `HEAD`
 * alias. A repo with no commits yet has none.
 */
async function readHead(dir: string, runGit: GitRunner): Promise<string | undefined> {
  try {
    const { stdout } = await runGit(['-C', dir, 'rev-parse', 'HEAD']);
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Blob hash the index holds for each staged path. The working tree's identity
 * comes from `lstat`, but the index has no file to stat — without this, staged
 * content has no identity at all, and anything keyed on one keeps showing the
 * snapshot from before the last `git add`. Bounded by the staged change count
 * rather than the size of the index.
 */
async function readStagedBlobIds(dir: string, runGit: GitRunner): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  try {
    // Raw format, NUL-separated: `:<srcmode> <dstmode> <srcsha> <dstsha> <X>\0<path>\0`.
    const { stdout } = await runGit(['-C', dir, 'diff-index', '--cached', '-z', 'HEAD']);
    const tokens = stdout.split('\0');
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const meta = tokens[i];
      if (!meta.startsWith(':')) break;
      const dstSha = meta.slice(1).split(' ')[3];
      // All-zero destination means the path is staged for deletion.
      if (dstSha && !/^0+$/.test(dstSha)) ids.set(tokens[i + 1], dstSha);
    }
  } catch {
    // No commits yet (no HEAD to diff against), or a repo git refuses to read.
    // A missing id just means "identity unknown" to callers.
  }
  return ids;
}

export async function getStatusDetailed(
  dir: string,
  runGit: GitRunner = localGitRunner,
  /** False when `dir` names a path on another machine, where `lstat` would
   *  describe an unrelated local file or nothing at all. */
  localFs = true,
): Promise<DetailedStatus> {
  const { stdout } = await runGit(['-C', dir, 'status', '--porcelain=v1', '-b', '-z']);
  const { branch, entries } = parsePorcelainStatus(stdout);

  const parsed: DetailedFileStatus[] = entries.flatMap((e) =>
    expandStatusEntry(e.index, e.workingDir).map((row) => ({
      path: e.path,
      ...row,
      // Only the staged half of a rename spans two paths; the unstaged half
      // compares the index and the working tree, both at the new path.
      ...(row.staged && e.origPath ? { oldPath: e.origPath } : {}),
    })),
  );

  const [withIds, stagedIds, head] = await Promise.all([
    localFs ? withContentIds(dir, parsed) : Promise.resolve(parsed),
    readStagedBlobIds(dir, runGit),
    readHead(dir, runGit),
  ]);

  return {
    files: withIds.map((file) => ({ ...file, indexId: stagedIds.get(file.path) })),
    branch,
    head,
  };
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
  // A path can occupy more than one row (its staged and unstaged halves) but
  // has only one working-tree state, so it is stat'd once.
  const paths = [...new Set(files.map((f) => f.path))];
  const ids = new Map(
    await Promise.all(paths.map(async (p) => [p, await fileIdentity(dir, p)] as const)),
  );
  return files.map((file) => ({
    ...file,
    contentId: file.status === 'deleted' ? undefined : ids.get(file.path),
  }));
}

export async function isTracked(
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

export async function getGitRoot(dir: string, runGit: GitRunner): Promise<string> {
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
  compareTo: BranchDiffTarget = 'worktree',
): Promise<{
  files: Array<{ path: string; status: GitFileStatus; oldPath?: string; contentId?: string }>;
  mergeBase: string;
  head?: string;
}> {
  const mergeBase = await resolveMergeBase(dir, base, runGit);
  // `-M` matches getShow, so branch diffs report renames rather than add+delete pairs.
  const diffArgs = ['-C', dir, 'diff', '--name-status', '-M', mergeBase];
  if (compareTo === 'head') diffArgs.push('HEAD');

  const [{ stdout }, untracked, head] = await Promise.all([
    runGit(diffArgs),
    compareTo === 'worktree' ? getUntrackedFiles(dir, runGit) : Promise.resolve([]),
    readHead(dir, runGit),
  ]);

  const files = parseNameStatusOutput(stdout);
  // A path can appear in both lists after `git rm --cached`: the diff reports it
  // deleted while it survives on disk as untracked. The diff entry wins — losing
  // tracking is the change relative to the base — so it is not re-added here.
  const seen = new Set(files.map((f) => f.path));
  for (const path of untracked) {
    if (!seen.has(path)) files.push({ path, status: 'added' });
  }

  return { files: await withContentIds(dir, files), mergeBase, head };
}

// Remote names come from a user-editable base ref, so anything that could be
// read as an option (or another argument) is rejected rather than escaped.
const REMOTE_NAME = /^[A-Za-z0-9._-]+$/;

/**
 * Remote implied by a base ref: `origin/main` → `origin`. Plain branch names
 * carry no remote, and neither do refs whose first segment is not a real remote,
 * so the caller decides what to do with `undefined`.
 */
export async function remoteForBase(
  dir: string,
  base: string,
  runGit: GitRunner = localGitRunner,
): Promise<{ remote: string; branch: string } | undefined> {
  const [candidate, ...rest] = base.split('/');
  const branch = rest.join('/');
  if (!candidate || !REMOTE_NAME.test(candidate) || !branch) return undefined;

  try {
    const { stdout } = await runGit(['-C', dir, 'remote']);
    const remotes = stdout.split('\n').map((r) => r.trim());
    return remotes.includes(candidate) ? { remote: candidate, branch } : undefined;
  } catch {
    return undefined;
  }
}

// Comfortably inside the server's 60s dispatch budget, so a stuck fetch is
// killed here rather than left running after the request gives up.
const FETCH_TIMEOUT_MS = 55_000;

/**
 * Fetches just the branch this diff is based on. Deliberately not a whole-remote
 * `--prune` fetch: refs are shared with every other worktree of the repo, so
 * pruning could delete remote-tracking branches another session is using, and
 * only this one ref affects the fork point.
 */
export async function fetchRemote(
  dir: string,
  remote: string,
  branch: string,
  runGit: GitRunner = localGitRunner,
): Promise<void> {
  if (!REMOTE_NAME.test(remote)) {
    throw new Error(`Invalid remote name "${remote}"`);
  }
  if (!branch || branch.startsWith('-')) {
    throw new Error(`Invalid branch name "${branch}"`);
  }
  await runGit(['-C', dir, 'fetch', '--', remote, branch], { timeoutMs: FETCH_TIMEOUT_MS });
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
