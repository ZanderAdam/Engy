import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { getPatch, patchArgs, untrackedPatchArgs, MAX_PATCH_BYTES } from './patch.js';

describe('git patch', () => {
  describe('patchArgs', () => {
    it('[FR-GIT-390] should always disable path quoting and external diff drivers', () => {
      const args = patchArgs('/repo', { kind: 'unstaged' }, 'a.txt');

      expect(args.slice(0, 4)).toEqual(['-c', 'core.quotePath=false', '-C', '/repo']);
      expect(args).toContain('--no-ext-diff');
      expect(args).toContain('--no-color');
    });

    it('[FR-GIT-300] should compare the index against the working tree for an unstaged row', () => {
      const args = patchArgs('/repo', { kind: 'unstaged' }, 'a.txt');

      expect(args).toEqual([
        '-c', 'core.quotePath=false', '-C', '/repo',
        'diff', '--no-color', '--no-ext-diff', '-M', '--', 'a.txt',
      ]);
    });

    it('[FR-GIT-300] should compare the head commit against the index for a staged row', () => {
      const args = patchArgs('/repo', { kind: 'staged', head: 'abc123' }, 'a.txt');

      expect(args).toContain('--cached');
      expect(args.slice(-3)).toEqual(['abc123', '--', 'a.txt']);
    });

    it('[FR-GIT-300] should omit the head when a staged row has none, so a repo with no HEAD still diffs', () => {
      const args = patchArgs('/repo', { kind: 'staged' }, 'a.txt');

      expect(args.slice(-2)).toEqual(['--', 'a.txt']);
      expect(args).toContain('--cached');
    });

    it('[FR-GIT-390] should render a commit with -m --first-parent, which a merge commit needs', () => {
      const args = patchArgs('/repo', { kind: 'commit', hash: 'deadbee' }, 'a.txt');

      expect(args).toContain('show');
      expect(args).toContain('-m');
      expect(args).toContain('--first-parent');
      expect(args).toContain('--format=');
      expect(args.slice(-3)).toEqual(['deadbee', '--', 'a.txt']);
    });

    it('[FR-GIT-390] should diff a range against the working tree when it has no upper end', () => {
      const args = patchArgs('/repo', { kind: 'range', from: 'base1' }, 'a.txt');

      expect(args.slice(-3)).toEqual(['base1', '--', 'a.txt']);
    });

    it('[FR-GIT-390] should diff a range between two refs when it has both ends', () => {
      const args = patchArgs('/repo', { kind: 'range', from: 'base1', to: 'head1' }, 'a.txt');

      expect(args.slice(-4)).toEqual(['base1', 'head1', '--', 'a.txt']);
    });

    it('[FR-GIT-390] should pass both sides of a rename so -M can pair them', () => {
      const args = patchArgs('/repo', { kind: 'unstaged' }, 'new.txt', 'old.txt');

      expect(args.slice(-3)).toEqual(['--', 'old.txt', 'new.txt']);
    });

    it('[FR-GIT-390] should not repeat the path when the old path equals the new one', () => {
      const args = patchArgs('/repo', { kind: 'unstaged' }, 'a.txt', 'a.txt');

      expect(args.slice(-2)).toEqual(['--', 'a.txt']);
    });

    it('[FR-GIT-300] should read an untracked file relative to the repo root, keeping headers clean', () => {
      const args = untrackedPatchArgs('/repo', 'new.txt');

      expect(args).toEqual([
        '-c', 'core.quotePath=false', '-C', '/repo',
        'diff', '--no-index', '--no-color', '--', '/dev/null', 'new.txt',
      ]);
    });
  });

  describe('getPatch', () => {
    let repoDir: string;

    async function createTempRepo(): Promise<string> {
      const dir = await mkdtemp(join(tmpdir(), 'engy-patch-test-'));
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
      if (repoDir) await rm(repoDir, { recursive: true, force: true });
    });

    it('[FR-GIT-390] should produce a unified patch for a modified file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'original\n');
      await writeFile(join(repoDir, 'file.txt'), 'modified\n');

      const { patch } = await getPatch(repoDir, 'file.txt', { kind: 'unstaged' });

      expect(patch).toContain('--- a/file.txt');
      expect(patch).toContain('+++ b/file.txt');
      expect(patch).toContain('-original');
      expect(patch).toContain('+modified');
    });

    it('[FR-GIT-390] should return an empty patch for an unchanged file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content\n');

      const { patch } = await getPatch(repoDir, 'file.txt', { kind: 'unstaged' });

      expect(patch).toBe('');
    });

    it('[FR-GIT-300] should produce a whole-file patch for an untracked file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello\n');
      await writeFile(join(repoDir, 'untracked.txt'), 'untracked content\n');

      const { patch } = await getPatch(repoDir, 'untracked.txt', { kind: 'unstaged' });

      expect(patch).toContain('+untracked content');
      // Repo-relative, not the absolute path `--no-index` emits by default.
      expect(patch).toContain('b/untracked.txt');
    });

    it('[FR-GIT-300] should produce a patch for a staged new file', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello\n');
      await writeFile(join(repoDir, 'new.txt'), 'staged content\n');
      await simpleGit(repoDir).add('new.txt');

      const { patch } = await getPatch(repoDir, 'new.txt', { kind: 'staged' });

      expect(patch).toContain('+staged content');
    });

    it('[FR-GIT-300] should produce a patch for a staged new file in a repo with no HEAD', async () => {
      repoDir = await createTempRepo();
      await writeFile(join(repoDir, 'first.txt'), 'first file\n');
      await simpleGit(repoDir).add('first.txt');

      const { patch } = await getPatch(repoDir, 'first.txt', { kind: 'staged' });

      expect(patch).toContain('+first file');
    });

    it('[FR-GIT-390] should render a root commit as a whole-file addition', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'a\nb\n');
      const hash = (await simpleGit(repoDir).log()).latest!.hash;

      const { patch } = await getPatch(repoDir, 'file.txt', { kind: 'commit', hash });

      expect(patch).toContain('new file mode');
      expect(patch).toContain('+a');
      expect(patch).toContain('+b');
    });

    it('[FR-GIT-390] should render a merge commit against its first parent', async () => {
      repoDir = await createTempRepo();
      const git = simpleGit(repoDir);
      await commitFile(repoDir, 'file.txt', 'a\nb\nc\n');
      await commitFile(repoDir, 'other.txt', 'x\n');
      const base = await git.revparse(['--abbrev-ref', 'HEAD']);

      await git.checkoutLocalBranch('side');
      await writeFile(join(repoDir, 'file.txt'), 'a\nb\nc\nd\n');
      await git.add('file.txt');
      await git.commit('side');

      await git.checkout(base);
      await writeFile(join(repoDir, 'other.txt'), 'y\n');
      await git.add('other.txt');
      await git.commit('mainline');
      await git.merge(['side', '--no-ff', '-m', 'merge']);
      const hash = await git.revparse(['HEAD']);

      const { patch } = await getPatch(repoDir, 'file.txt', { kind: 'commit', hash });

      // A plain `git show` of a merge prints nothing at all.
      expect(patch).toContain('+d');
    });

    it('[FR-GIT-390] should report a rename as one change rather than an add/delete pair', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'old.txt', 'stable content\n');
      const git = simpleGit(repoDir);
      await git.mv('old.txt', 'new.txt');
      await git.commit('rename');
      const hash = await git.revparse(['HEAD']);

      const { patch } = await getPatch(
        repoDir,
        'new.txt',
        { kind: 'commit', hash },
        'old.txt',
      );

      expect(patch).toContain('rename from old.txt');
      expect(patch).toContain('rename to new.txt');
    });

    it('[FR-GIT-390] should keep a non-ASCII path literal rather than octal-escaping it', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'café.txt', 'original\n');
      await writeFile(join(repoDir, 'café.txt'), 'modified\n');

      const { patch } = await getPatch(repoDir, 'café.txt', { kind: 'unstaged' });

      expect(patch).toContain('café.txt');
      expect(patch).not.toContain('\\303');
    });

    it('[FR-GIT-390] should diff a branch range against the working tree', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'v1\n');
      const base = await simpleGit(repoDir).revparse(['HEAD']);
      await writeFile(join(repoDir, 'file.txt'), 'v2\n');

      const { patch } = await getPatch(repoDir, 'file.txt', { kind: 'range', from: base });

      expect(patch).toContain('-v1');
      expect(patch).toContain('+v2');
    });

    it('[FR-GIT-390] should diff a branch range between two commits', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'v1\n');
      const git = simpleGit(repoDir);
      const base = await git.revparse(['HEAD']);
      await writeFile(join(repoDir, 'file.txt'), 'v2\n');
      await git.add('file.txt');
      await git.commit('update');
      const head = await git.revparse(['HEAD']);
      // Uncommitted work the `to` end must exclude.
      await writeFile(join(repoDir, 'file.txt'), 'v3\n');

      const { patch } = await getPatch(repoDir, 'file.txt', { kind: 'range', from: base, to: head });

      expect(patch).toContain('+v2');
      expect(patch).not.toContain('+v3');
    });

    it('[FR-GIT-390] should resolve paths against the repo root when given a subdirectory', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'original\n');
      await writeFile(join(repoDir, 'file.txt'), 'modified\n');
      const sub = join(repoDir, 'sub');
      await mkdir(sub);

      // Paths from git status are repo-root relative, so `file.txt` must still
      // resolve when the caller hands us a subdirectory.
      const { patch } = await getPatch(sub, 'file.txt', { kind: 'unstaged' });

      expect(patch).toContain('+modified');
    });

    it('[FR-GIT-390] should report a patch over the size cap as truncated instead of returning it', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'big.txt', '');
      const huge = 'x'.repeat(80) + '\n';
      await writeFile(join(repoDir, 'big.txt'), huge.repeat(Math.ceil(MAX_PATCH_BYTES / 80) + 100));

      const result = await getPatch(repoDir, 'big.txt', { kind: 'unstaged' });

      expect(result.truncated).toBe(true);
      expect(result.patch).toBe('');
    });

    it('[FR-GIT-390] should surface a bad ref as an error rather than a silent empty patch', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content\n');

      await expect(
        getPatch(repoDir, 'file.txt', { kind: 'range', from: 'no-such-ref' }),
      ).rejects.toThrow();
    });
  });
});
