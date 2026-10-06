import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearSshHostCache, expandGithubSshAlias } from './remote-alias';

describe('expandGithubSshAlias', () => {
  beforeEach(() => {
    clearSshHostCache();
  });

  it('[FR-PRMON-330] should replace an alias that resolves to github.com in an scp-style url', async () => {
    const resolve = vi.fn().mockResolvedValue('github.com');

    await expect(expandGithubSshAlias('git@github-work:octo/repo.git', resolve)).resolves.toBe(
      'git@github.com:octo/repo.git',
    );
    expect(resolve).toHaveBeenCalledWith('github-work');
  });

  it('[FR-PRMON-330] should replace an alias in an ssh:// url and keep the port', async () => {
    const resolve = vi.fn().mockResolvedValue('github.com');

    await expect(
      expandGithubSshAlias('ssh://git@github-work:22/octo/repo.git', resolve),
    ).resolves.toBe('ssh://git@github.com:22/octo/repo.git');
  });

  it('[FR-PRMON-330] should keep the url when the alias resolves to another host', async () => {
    const resolve = vi.fn().mockResolvedValue('gitlab.com');

    await expect(expandGithubSshAlias('git@gl-work:octo/repo.git', resolve)).resolves.toBe(
      'git@gl-work:octo/repo.git',
    );
  });

  it('[FR-PRMON-330] should keep the url when resolution fails', async () => {
    const resolve = vi.fn().mockResolvedValue(null);

    await expect(expandGithubSshAlias('git@github-work:octo/repo.git', resolve)).resolves.toBe(
      'git@github-work:octo/repo.git',
    );
  });

  it('[FR-PRMON-330] should cache the resolution per alias', async () => {
    const resolve = vi.fn().mockResolvedValue('github.com');

    await expandGithubSshAlias('git@github-work:octo/a.git', resolve);
    await expandGithubSshAlias('git@github-work:octo/b.git', resolve);

    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it.each(['git@github.com:octo/repo.git', 'https://github-work/octo/repo.git', '/local/repo'])(
    'should not resolve %s',
    async (url) => {
      const resolve = vi.fn();

      await expect(expandGithubSshAlias(url, resolve)).resolves.toBe(url);
      expect(resolve).not.toHaveBeenCalled();
    },
  );
});
