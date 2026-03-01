import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { getBranchInfo, getStatus } from './index.js';

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
});
