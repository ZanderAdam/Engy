import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { getBranchInfo, getStatus, getStatusDetailed, getDiff, getLog, getShow } from './index.js';

describe('git integration', () => {
  let repoDir: string;

  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'engy-git-test-'));
    const git = simpleGit(dir);
    await git.init();
    await git.addConfig('user.email', 'test@test.com');
    await git.addConfig('user.name', 'Test');
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

  describe('getStatusDetailed', () => {
    it('returns empty files and branch for a clean repo', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'init.txt', 'hello');

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toEqual([]);
      expect(['main', 'master']).toContain(result.branch);
    });

    it('reports modified files with staged=false', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'original');
      await writeFile(join(repoDir, 'file.txt'), 'modified');

      const result = await getStatusDetailed(repoDir);

      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toEqual({ path: 'file.txt', status: 'modified', staged: false });
    });

    it('reports staged added files', async () => {
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

    it('respects maxCount', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'a.txt', 'a');
      await commitFile(repoDir, 'b.txt', 'b');
      await commitFile(repoDir, 'c.txt', 'c');

      const commits = await getLog(repoDir, 2);

      expect(commits).toHaveLength(2);
    });
  });

  describe('getShow', () => {
    it('returns diff and changed files for a commit', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content');
      const git = simpleGit(repoDir);
      const log = await git.log();
      const hash = log.latest!.hash;

      const result = await getShow(repoDir, hash);

      expect(result.diff).toContain('+content');
      expect(result.files).toHaveLength(1);
      expect(result.files[0]).toEqual({ path: 'file.txt', status: 'added' });
    });
  });
});
