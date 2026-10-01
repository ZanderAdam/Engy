import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import * as wsServer from '../ws/server';
import { parseGithubRemote, resolveRepoFullName } from './repo-identity';

vi.mock('../ws/server', () => ({ dispatchGitRemoteUrl: vi.fn() }));

const dispatchSpy = vi.mocked(wsServer.dispatchGitRemoteUrl);

describe('parseGithubRemote', () => {
  it.each([
    ['git@github.com:octo/repo.git', 'octo/repo'],
    ['git@github.com:octo/repo', 'octo/repo'],
    ['ssh://git@github.com/octo/repo', 'octo/repo'],
    ['ssh://git@github.com/octo/repo.git', 'octo/repo'],
    ['ssh://git@github.com:22/octo/repo.git', 'octo/repo'],
    ['https://github.com/octo/repo', 'octo/repo'],
    ['https://github.com/octo/repo.git', 'octo/repo'],
    ['https://github.com/octo/repo/', 'octo/repo'],
    ['https://user:token@github.com/octo/repo.git', 'octo/repo'],
    ['  https://github.com/octo/my.repo.git\n', 'octo/my.repo'],
  ])('[FR-TG1.5] should parse %s as %s', (url, expected) => {
    expect(parseGithubRemote(url)).toBe(expected);
  });

  it.each([
    'git@gitlab.com:octo/repo.git',
    'https://gitlab.com/octo/repo.git',
    'https://github.example.com/octo/repo.git',
    'https://notgithub.com/octo/repo.git',
    'https://github.com/octo',
    'https://github.com/octo/repo/extra',
    '/local/path/repo.git',
    '',
  ])('[FR-TG1.5] should return null for %s', (url) => {
    expect(parseGithubRemote(url)).toBeNull();
  });
});

describe('resolveRepoFullName', () => {
  let state: AppState;

  beforeEach(() => {
    state = createAppState();
    dispatchSpy.mockReset();
  });

  it('[FR-TG1.5] should resolve owner/name from the daemon-reported origin', async () => {
    dispatchSpy.mockResolvedValue({ url: 'git@github.com:octo/repo.git' });

    await expect(resolveRepoFullName(state, '/repo')).resolves.toBe('octo/repo');
    expect(dispatchSpy).toHaveBeenCalledWith('/repo', state);
  });

  it('[FR-TG1.5] should cache per repo path', async () => {
    dispatchSpy.mockResolvedValue({ url: 'https://github.com/octo/repo' });

    await resolveRepoFullName(state, '/repo');
    await resolveRepoFullName(state, '/repo');
    await resolveRepoFullName(state, '/other');

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });

  it('[FR-TG1.5] should cache a non-github remote as null', async () => {
    dispatchSpy.mockResolvedValue({ url: 'https://gitlab.com/octo/repo.git' });

    await expect(resolveRepoFullName(state, '/repo')).resolves.toBeNull();
    await expect(resolveRepoFullName(state, '/repo')).resolves.toBeNull();
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
  });

  it('[FR-TG1.5] should not cache when the repo has no origin', async () => {
    dispatchSpy.mockResolvedValue({ url: null });

    await expect(resolveRepoFullName(state, '/repo')).resolves.toBeNull();
    await resolveRepoFullName(state, '/repo');
    expect(dispatchSpy).toHaveBeenCalledTimes(2);
  });

  it('[FR-TG1.5] should not cache a daemon failure', async () => {
    dispatchSpy.mockRejectedValueOnce(new Error('No daemon connected'));
    dispatchSpy.mockResolvedValueOnce({ url: 'git@github.com:octo/repo.git' });

    await expect(resolveRepoFullName(state, '/repo')).rejects.toThrow('No daemon connected');
    await expect(resolveRepoFullName(state, '/repo')).resolves.toBe('octo/repo');
  });
});
