import type { GitPatchSpec } from '@engy/common';
import { getGitRoot, isTracked, localGitRunner, type GitRunner } from './index.js';

/**
 * Beyond this the patch is not worth pushing across the WebSocket control
 * channel, which every other daemon op shares.
 */
export const MAX_PATCH_BYTES = 2 * 1024 * 1024;

interface GitPatchResult {
  patch: string;
  /** Set when the patch exceeded `MAX_PATCH_BYTES`; `patch` is then empty. */
  truncated?: boolean;
}

/**
 * `core.quotePath=false` keeps a non-ASCII path literal instead of octal-escaped,
 * which `gitdiff-parser` cannot decode back.
 */
function globalArgs(dir: string): string[] {
  return ['-c', 'core.quotePath=false', '-C', dir];
}

/**
 * `--no-ext-diff` stops a user's `diff.external` driver from replacing the patch
 * with output that is not a patch at all. `-M` matches `getShow` and
 * `getBranchFiles`, so a rename reads as one change rather than an add/delete pair.
 */
const PATCH_FLAGS = ['--no-color', '--no-ext-diff', '-M'];

/** A rename needs both sides in the pathspec for `-M` to pair them. */
function pathspec(filePath: string, oldPath?: string): string[] {
  return oldPath && oldPath !== filePath ? [oldPath, filePath] : [filePath];
}

/**
 * The git invocation for one file's patch. Pure, so each spec kind's argument
 * shape is asserted directly.
 */
export function patchArgs(
  dir: string,
  spec: GitPatchSpec,
  filePath: string,
  oldPath?: string,
): string[] {
  const args = [...globalArgs(dir)];
  const paths = pathspec(filePath, oldPath);

  switch (spec.kind) {
    case 'staged':
      // `--cached` alone already compares HEAD to the index, and copes with a
      // repo that has no HEAD yet. `head` pins it to the commit the file list
      // was computed against, so a commit landing mid-review cannot move it.
      return [
        ...args,
        'diff',
        '--cached',
        ...PATCH_FLAGS,
        ...(spec.head ? [spec.head] : []),
        '--',
        ...paths,
      ];
    case 'unstaged':
      return [...args, 'diff', ...PATCH_FLAGS, '--', ...paths];
    case 'commit':
      // `-m --first-parent` is load-bearing: a plain `git show` of a merge commit
      // prints no patch at all. `--format=` drops the commit header, leaving only
      // the diff. Unlike `diff-tree`, `show` needs no parent probe — it renders a
      // root commit as a whole-file addition on its own.
      return [
        ...args,
        'show',
        '--format=',
        '-m',
        '--first-parent',
        ...PATCH_FLAGS,
        spec.hash,
        '--',
        ...paths,
      ];
    case 'range':
      return [
        ...args,
        'diff',
        ...PATCH_FLAGS,
        spec.from,
        ...(spec.to ? [spec.to] : []),
        '--',
        ...paths,
      ];
  }
}

/**
 * Whole-file addition for a path git does not track. Run from the repo root with
 * a relative path so the patch header reads `a/foo.ts`, not the absolute path
 * `--no-index` would otherwise emit.
 */
export function untrackedPatchArgs(dir: string, filePath: string): string[] {
  return [...globalArgs(dir), 'diff', '--no-index', '--no-color', '--', '/dev/null', filePath];
}

/** `git diff` only ever reports tracked paths, so only these two can miss one. */
function targetsWorkingTree(spec: GitPatchSpec): boolean {
  return spec.kind === 'unstaged' || (spec.kind === 'range' && !spec.to);
}

function capped(patch: string): GitPatchResult {
  return Buffer.byteLength(patch, 'utf8') > MAX_PATCH_BYTES
    ? { patch: '', truncated: true }
    : { patch };
}

async function untrackedPatch(root: string, filePath: string, runGit: GitRunner): Promise<string> {
  try {
    const { stdout } = await runGit(untrackedPatchArgs(root, filePath));
    return stdout;
  } catch (e: unknown) {
    // `--no-index` exits 1 whenever the files differ, which is always here.
    const stdout = (e as { stdout?: string })?.stdout;
    if (typeof stdout === 'string') return stdout;
    throw e;
  }
}

/**
 * Unified diff text for one file. Paths from git status are relative to the git
 * root, which may differ from `dir` when `dir` is a subdirectory of the repo.
 */
export async function getPatch(
  dir: string,
  filePath: string,
  spec: GitPatchSpec,
  oldPath?: string,
  runGit: GitRunner = localGitRunner,
): Promise<GitPatchResult> {
  const root = await getGitRoot(dir, runGit);

  const fallback = async (cause: unknown): Promise<GitPatchResult> => {
    if (targetsWorkingTree(spec) && !(await isTracked(root, filePath, runGit))) {
      return capped(await untrackedPatch(root, filePath, runGit));
    }
    if (cause) throw cause;
    return { patch: '' };
  };

  try {
    const { stdout } = await runGit(patchArgs(root, spec, filePath, oldPath));
    // An empty patch is ambiguous: the file genuinely has no change against this
    // spec, or git never tracked it and silently reported nothing.
    return stdout ? capped(stdout) : fallback(null);
  } catch (err) {
    return fallback(err);
  }
}
