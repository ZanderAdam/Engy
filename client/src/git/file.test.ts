import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleGit } from 'simple-git';
import { getFileContent, writeFileContent } from './index.js';

describe('file operations', () => {
  let repoDir: string;

  async function createTempRepo(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'engy-file-test-'));
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

  describe('getFileContent', () => {
    it('reads a file from a git ref', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'version 1');

      // Modify the file on disk but read from HEAD
      await writeFile(join(repoDir, 'file.txt'), 'version 2');

      const content = await getFileContent(repoDir, 'file.txt', 'HEAD');

      expect(content).toBe('version 1');
    });

    it('reads a file from disk when no ref is provided', async () => {
      repoDir = await createTempRepo();
      await writeFile(join(repoDir, 'file.txt'), 'disk content');

      const content = await getFileContent(repoDir, 'file.txt');

      expect(content).toBe('disk content');
    });

    it('reads a file using an absolute path', async () => {
      repoDir = await createTempRepo();
      const absPath = join(repoDir, 'abs.txt');
      await writeFile(absPath, 'absolute');

      const content = await getFileContent(repoDir, absPath);

      expect(content).toBe('absolute');
    });

    it('throws for an invalid git ref', async () => {
      repoDir = await createTempRepo();
      await commitFile(repoDir, 'file.txt', 'content');

      await expect(
        getFileContent(repoDir, 'file.txt', 'nonexistent-ref'),
      ).rejects.toThrow();
    });
  });

  describe('writeFileContent', () => {
    it('writes content to a file', async () => {
      repoDir = await createTempRepo();
      const filePath = 'output.txt';

      await writeFileContent(repoDir, filePath, 'written content');

      const result = await readFile(join(repoDir, filePath), 'utf-8');
      expect(result).toBe('written content');
    });

    it('overwrites an existing file', async () => {
      repoDir = await createTempRepo();
      await writeFile(join(repoDir, 'existing.txt'), 'old');

      await writeFileContent(repoDir, 'existing.txt', 'new');

      const result = await readFile(join(repoDir, 'existing.txt'), 'utf-8');
      expect(result).toBe('new');
    });

    it('writes to an absolute path', async () => {
      repoDir = await createTempRepo();
      const absPath = join(repoDir, 'abs-write.txt');

      await writeFileContent(repoDir, absPath, 'absolute write');

      const result = await readFile(absPath, 'utf-8');
      expect(result).toBe('absolute write');
    });

    it('throws when writing to a non-existent directory', async () => {
      repoDir = await createTempRepo();

      await expect(
        writeFileContent(repoDir, 'no/such/dir/file.txt', 'content'),
      ).rejects.toThrow();
    });
  });
});
