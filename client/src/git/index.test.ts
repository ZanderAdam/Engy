import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import {
  getBranchInfo,
  getStatus,
  getStatusDetailed,
  getDiff,
  getLog,
  getShow,
  getBranchFiles,
  resolveDefaultBase,
  parsePorcelainStatus,
  parseWorktreeList,
  globTestFiles,
} from './index.js';

describe('git integration', () => {
  let repoDir: string;

  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'engy-git-test-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
    await git.addConfig('commit.gpgsign', 'false');
    return dir;
  }

  async function commitFile(dir: string, name: string, content: string) {
    await writeFile(join(dir, name), content);
    const git = simpleGit(dir);
    await git.add(name);
    await git.commit(`add ${name}`);
  }

  afterEach(async () => {
    if (repoDir) {
      await rm(repoDir, { recursive: true, force: true });
    }
  });

  describe('getBranchInfo', () => {
    it('returns the default branch name for a fresh repo', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      const info = await getBranchInfo(repoDir);

      expect(['main', 'master']).toContain(info.current);
      expect(info.isDetached).toBe(false);
    });

    it('reports detached HEAD after checking out a commit hash', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      const git = simpleGit(repoDir);
      const log = await git.log();
      await git.checkout(log.latest!.hash);

      const info = await getBranchInfo(repoDir);

      expect(info.isDetached).toBe(true);
    });
  });

  describe('getStatus', () => {
    it('returns an empty array for a clean repo', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      const files = await getStatus(repoDir);

      expect(files).toEqual([]);
    });

    it('reports modified files after editing a tracked file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'original');

      await writeFile(join(repoDir, 'file.txt'), 'modified');

      const files = await getStatus(repoDir);

      expect(files).toEqual([{ path: 'file.txt', status: 'M' }]);
    });

    it('reports untracked files', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      await writeFile(join(repoDir, 'new-file.txt'), 'untracked');

      const files = await getStatus(repoDir);

      expect(files).toEqual([{ path: 'new-file.txt', status: '?' }]);
    });
  });

  describe('getStatusDetailed (no-commit repo)', () => {
    it('[FR-GIT-070] returns the real branch name for a fresh repo with no commits', async () => {
      repoDir = await createTempRepo();
      // No commits — git emits "## No commits yet on <branch>"

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toEqual([]);
      // Branch must be the real default branch, not 'No'
      expect(['main', 'master']).toContain(result.branch);
    });
  });

  describe('getStatusDetailed', () => {
    it('returns empty files and branch for a clean repo', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toEqual([]);
      expect(['main', 'master']).toContain(result.branch);
    });

    it('[FR-GIT-080] reports modified files with staged=false', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'original');
      await writeFile(join(repoDir, 'file.txt'), 'modified');

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toEqual({ path: 'file.txt', status: 'modified', staged: false });
    });

    it('[FR-GIT-080] reports staged added files', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      await writeFile(join(repoDir, 'new.txt'), 'content');
      const git = simpleGit(repoDir);
      await git.add('new.txt');

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toEqual({ path: 'new.txt', status: 'added', staged: true });
    });

    it('reports deleted files', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content');
      const { rm: removeFile } = await import('node:fs/promises');
      await removeFile(join(repoDir, 'file.txt'));

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toHaveLength(1);
      expect(result.files[0].status).toBe('deleted');
    });
  });

  describe('getDiff', () => {
    it('returns unified diff for a modified file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'original');
      await writeFile(join(repoDir, 'file.txt'), 'modified');

      const diff = await getDiff(repoDir, 'file.txt');

      expect(diff).toContain('--- a/file.txt');
      expect(diff).toContain('+++ b/file.txt');
      expect(diff).toContain('-original');
      expect(diff).toContain('+modified');
    });

    it('returns diff against a base ref', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'v1');
      const git = simpleGit(repoDir);
      const log1 = await git.log();
      const baseHash = log1.latest!.hash;
      await writeFile(join(repoDir, 'file.txt'), 'v2');
      await git.add('file.txt');
      await git.commit('update file');

      const diff = await getDiff(repoDir, 'file.txt', baseHash);

      expect(diff).toContain('-v1');
      expect(diff).toContain('+v2');
    });

    it('returns empty string for unchanged file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content');

      const diff = await getDiff(repoDir, 'file.txt');

      expect(diff).toBe('');
    });

    it('returns diff for a staged new file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      await writeFile(join(repoDir, 'new.txt'), 'staged content');
      const git = simpleGit(repoDir);
      await git.add('new.txt');

      const diff = await getDiff(repoDir, 'new.txt', undefined, true);

      expect(diff).toContain('+staged content');
    });

    it('returns diff for an untracked file (path resolution bug fix)', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      await writeFile(join(repoDir, 'untracked.txt'), 'untracked content');

      const diff = await getDiff(repoDir, 'untracked.txt');

      expect(diff).toContain('+untracked content');
    });

    it('returns diff for a staged new file in a repo with no HEAD', async () => {
      repoDir = await createTempRepo();
      await writeFile(join(repoDir, 'first.txt'), 'first file');
      const git = simpleGit(repoDir);
      await git.add('first.txt');

      const diff = await getDiff(repoDir, 'first.txt', undefined, true);

      expect(diff).toContain('+first file');
    });
  });

  describe('getLog', () => {
    it('returns commits in reverse chronological order', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'a.txt', 'a');
      await commitFile(repoDir, 'b.txt', 'b');

      const commits = await getLog(repoDir, 10);

      expect(commits).toHaveLength(2);
      expect(commits[0].message).toBe('add b.txt');
      expect(commits[1].message).toBe('add a.txt');
      expect(commits[0].hash).toBeTruthy();
      expect(commits[0].author).toBe('Test');
      expect(commits[0].date).toBeTruthy();
    });

    it('[FR-GIT-030] respects maxCount', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'a.txt', 'a');
      await commitFile(repoDir, 'b.txt', 'b');
      await commitFile(repoDir, 'c.txt', 'c');

      const commits = await getLog(repoDir, 2);

      expect(commits).toHaveLength(2);
    });
  });

  describe('resolveDefaultBase', () => {
    it('[FR-GIT-190] prefers the recorded origin/HEAD when the clone set one', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      const git = simpleGit(repoDir);
      await git.raw(['update-ref', 'refs/remotes/origin/develop', 'HEAD']);
      await git.raw([
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/develop',
      ]);

      await expect(resolveDefaultBase(repoDir)).resolves.toBe('origin/develop');
    });

    it('[FR-GIT-190] ignores a stale origin/HEAD that no longer resolves', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      const git = simpleGit(repoDir);
      // Points at a remote branch that was renamed away; the ref file remains.
      await git.raw([
        'symbolic-ref',
        'refs/remotes/origin/HEAD',
        'refs/remotes/origin/deleted-branch',
      ]);

      const base = await resolveDefaultBase(repoDir);

      expect(base).not.toBe('origin/deleted-branch');
      expect(['main', 'master']).toContain(base);
    });

    it('[FR-GIT-190] probes well-known remote names when origin/HEAD is absent', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      const git = simpleGit(repoDir);
      await git.raw(['update-ref', 'refs/remotes/origin/master', 'HEAD']);

      await expect(resolveDefaultBase(repoDir)).resolves.toBe('origin/master');
    });

    it('[FR-GIT-190] falls back to a local branch when no remote ref exists', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      const base = await resolveDefaultBase(repoDir);

      expect(['main', 'master']).toContain(base);
    });

    it('[FR-GIT-190] falls back to the current branch when nothing well-known matches', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');
      const git = simpleGit(repoDir);
      await git.raw(['branch', '-m', 'trunk']);

      await expect(resolveDefaultBase(repoDir)).resolves.toBe('trunk');
    });
  });

  describe('getBranchFiles', () => {
    it('[FR-GIT-200] excludes commits the base gained after the branch forked', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'base.txt', 'base');
      const git = simpleGit(repoDir);
      const mainBranch = (await git.status()).current!;
      await git.checkoutLocalBranch('feature');
      await commitFile(repoDir, 'feature.txt', 'feature');
      // Base moves on independently — a two-dot diff would report this as a deletion.
      await git.checkout(mainBranch);
      await commitFile(repoDir, 'landed-on-main.txt', 'main');
      await git.checkout('feature');

      const { files } = await getBranchFiles(repoDir, mainBranch);

      expect(files).toEqual([{ path: 'feature.txt', status: 'added' }]);
    });

    it('[FR-GIT-200] returns the merge base the diff was taken against', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'base.txt', 'base');
      const git = simpleGit(repoDir);
      const mainBranch = (await git.status()).current!;
      const forkPoint = (await git.log()).latest!.hash;
      await git.checkoutLocalBranch('feature');
      await commitFile(repoDir, 'feature.txt', 'feature');
      await git.checkout(mainBranch);
      await commitFile(repoDir, 'landed-on-main.txt', 'main');
      await git.checkout('feature');

      const { mergeBase } = await getBranchFiles(repoDir, mainBranch);

      expect(mergeBase).toBe(forkPoint);
    });

    it('[FR-GIT-200] includes uncommitted working-tree changes', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'base.txt', 'base');
      const git = simpleGit(repoDir);
      const mainBranch = (await git.status()).current!;
      await git.checkoutLocalBranch('feature');
      await writeFile(join(repoDir, 'uncommitted.txt'), 'wip');
      await git.add('uncommitted.txt');

      const { files } = await getBranchFiles(repoDir, mainBranch);

      expect(files).toEqual([{ path: 'uncommitted.txt', status: 'added' }]);
    });

    it('[FR-GIT-200] reports renames rather than an add/delete pair', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'original.txt', 'a stable body of text to match on\n');
      const git = simpleGit(repoDir);
      const mainBranch = (await git.status()).current!;
      await git.checkoutLocalBranch('feature');
      await git.mv('original.txt', 'renamed.txt');
      await git.commit('rename');

      const { files } = await getBranchFiles(repoDir, mainBranch);

      expect(files).toEqual([
        { path: 'renamed.txt', status: 'renamed', oldPath: 'original.txt' },
      ]);
    });

    it('[FR-GIT-210] rejects a base ref that cannot be resolved', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'base.txt', 'base');

      await expect(getBranchFiles(repoDir, 'no-such-ref')).rejects.toThrow();
    });

    it('[FR-GIT-210] falls back to a base-tip diff for unrelated histories', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'trunk.txt', 'trunk');
      const git = simpleGit(repoDir);
      const trunk = (await git.status()).current!;
      // An orphan branch shares no ancestor with trunk, so there is no merge base.
      await git.raw(['checkout', '--orphan', 'orphan']);
      await git.raw(['rm', '-rf', '--cached', '.']);
      await rm(join(repoDir, 'trunk.txt'), { force: true });
      await commitFile(repoDir, 'orphan.txt', 'orphan');

      const { files, mergeBase } = await getBranchFiles(repoDir, trunk);

      expect(mergeBase).toBe(trunk);
      expect(files.map((f) => f.path).sort()).toEqual(['orphan.txt', 'trunk.txt']);
    });
  });

  describe('getShow', () => {
    it('[FR-GIT-040] returns changed files for a root commit', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content');
      const git = simpleGit(repoDir);
      const log = await git.log();
      const hash = log.latest!.hash;

      const result = await getShow(repoDir, hash);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toEqual({ path: 'file.txt', status: 'added' });
    });

    it('[FR-GIT-040] diffs merge commits against the first parent', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'base.txt', 'base');
      const git = simpleGit(repoDir);
      const mainBranch = (await git.status()).current!;
      await git.checkoutLocalBranch('feature');
      await commitFile(repoDir, 'feature.txt', 'feature');
      await git.checkout(mainBranch);
      await commitFile(repoDir, 'main.txt', 'main');
      await git.merge(['feature', '--no-ff']);
      const mergeHash = (await git.log()).latest!.hash;

      const result = await getShow(repoDir, mergeHash);

      expect(result.files).toEqual([{ path: 'feature.txt', status: 'added' }]);
    });

    it('[FR-GIT-050] reports renames with the old path', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'old-name.txt', 'stable content for rename detection');
      const git = simpleGit(repoDir);
      await git.mv('old-name.txt', 'new-name.txt');
      await git.commit('rename file');
      const hash = (await git.log()).latest!.hash;

      const result = await getShow(repoDir, hash);

      expect(result.files).toEqual([
        { path: 'new-name.txt', status: 'renamed', oldPath: 'old-name.txt' },
      ]);
    });
  });

  describe('parsePorcelainStatus', () => {
    it('parses branch and entries with NUL separators', () => {
      const out = '## main...origin/main\0 M file1.txt\0A  file2.txt\0?? file3.txt\0';
      const result = parsePorcelainStatus(out);
      expect(result.branch).toBe('main');
      expect(result.entries).toEqual([
        { index: ' ', workingDir: 'M', path: 'file1.txt' },
        { index: 'A', workingDir: ' ', path: 'file2.txt' },
        { index: '?', workingDir: '?', path: 'file3.txt' },
      ]);
    });

    it('handles renames by skipping the original-path token', () => {
      const out = '## main\0R  newname.txt\0oldname.txt\0 M other.txt\0';
      const result = parsePorcelainStatus(out);
      expect(result.entries).toEqual([
        { index: 'R', workingDir: ' ', path: 'newname.txt' },
        { index: ' ', workingDir: 'M', path: 'other.txt' },
      ]);
    });

    it('[FR-GIT-070] reports HEAD for detached state', () => {
      const out = '## HEAD (no branch)\0';
      const result = parsePorcelainStatus(out);
      expect(result.branch).toBe('HEAD');
      expect(result.entries).toEqual([]);
    });

    it('[FR-GIT-070] reports the real branch name for a repo with no commits yet', () => {
      const out = '## No commits yet on main\0';
      const result = parsePorcelainStatus(out);
      expect(result.branch).toBe('main');
      expect(result.entries).toEqual([]);
    });

    it('[FR-GIT-070] reports the real branch name for a no-commit repo on a custom branch', () => {
      const out = '## No commits yet on feature/new\0';
      const result = parsePorcelainStatus(out);
      expect(result.branch).toBe('feature/new');
    });
  });

  describe('parseWorktreeList', () => {
    it('parses multiple worktrees with branches', () => {
      const out = [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo/.claude/worktrees/engy-session-xyz',
        'HEAD def456',
        'branch refs/heads/engy/session-xyz',
        '',
      ].join('\n');
      const result = parseWorktreeList(out);
      expect(result).toEqual([
        { path: '/repo', branch: 'main', isMain: true, isLocked: false },
        {
          path: '/repo/.claude/worktrees/engy-session-xyz',
          branch: 'engy/session-xyz',
          isMain: false,
          isLocked: false,
        },
      ]);
    });

    it('marks detached HEAD with null branch and locked entries', () => {
      const out = [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo/wt-detached',
        'HEAD def456',
        'detached',
        'locked maintenance',
        '',
      ].join('\n');
      const result = parseWorktreeList(out);
      expect(result).toHaveLength(2);
      expect(result[1]).toEqual({
        path: '/repo/wt-detached',
        branch: null,
        isMain: false,
        isLocked: true,
      });
    });
  });

  describe('globTestFiles', () => {
    it('[FR-GIT-160] returns absolute paths for staged and unstaged test files, excluding non-test files', async () => {
      repoDir = await createTempRepo();

      // Create a nested src/ directory
      await mkdir(join(repoDir, 'src'), { recursive: true });

      // Committed test file
      await commitFile(repoDir, 'src/foo.test.ts', 'test content');

      // Committed non-test file (should not be returned)
      await commitFile(repoDir, 'src/foo.ts', 'source content');

      // Committed non-test file at root (should not be returned)
      await commitFile(repoDir, 'README.md', 'readme');

      // Unstaged (untracked) new test file — NOT git-added
      await writeFile(join(repoDir, 'src/bar.test.ts'), 'unstaged test');

      const files = await globTestFiles(repoDir, ['*.test.ts', '*.test.tsx']);

      expect(files).toHaveLength(2);
      expect(files).toContain(join(repoDir, 'src/foo.test.ts'));
      expect(files).toContain(join(repoDir, 'src/bar.test.ts'));
      // Non-test files must not appear
      expect(files.some((f) => f.endsWith('foo.ts') && !f.endsWith('foo.test.ts'))).toBe(false);
      expect(files.some((f) => f.endsWith('README.md'))).toBe(false);
    });

    it('[FR-GIT-170] falls back to recursive readdir for non-git directories', async () => {
      const nonGitDir = await mkdtemp(join(tmpdir(), 'engy-nongit-test-'));
      try {
        await mkdir(join(nonGitDir, 'src'), { recursive: true });
        await writeFile(join(nonGitDir, 'src/util.test.ts'), 'test');
        await writeFile(join(nonGitDir, 'src/util.ts'), 'source');
        await writeFile(join(nonGitDir, 'src/comp.test.tsx'), 'test tsx');

        const files = await globTestFiles(nonGitDir, ['*.test.ts', '*.test.tsx']);

        expect(files).toHaveLength(2);
        expect(files).toContain(join(nonGitDir, 'src/util.test.ts'));
        expect(files).toContain(join(nonGitDir, 'src/comp.test.tsx'));
        expect(files.some((f) => f.endsWith('util.ts') && !f.endsWith('util.test.ts'))).toBe(false);
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });
  });
});
