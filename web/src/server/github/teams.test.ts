import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { startStubGithub, type StubGithub } from './stub-server';
import { getViewerTeams, TEAMS_REFRESH_MS } from './teams';

describe('[FR-INBOX-220] getViewerTeams', () => {
  let stub: StubGithub;
  let state: AppState;

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  it('should key teams as lowercased org/slug', async () => {
    stub.reply(() => ({ body: [{ slug: 'Core', organization: { login: 'Acme' } }] }));

    expect([...(await getViewerTeams(state))]).toEqual(['acme/core']);
  });

  it('should reuse the cached teams until the refresh interval passes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    stub.reply(() => ({ body: [] }));

    await getViewerTeams(state);
    await getViewerTeams(state);
    expect(stub.requests).toHaveLength(1);

    vi.advanceTimersByTime(TEAMS_REFRESH_MS + 1);
    await getViewerTeams(state);
    expect(stub.requests).toHaveLength(2);
  });

  it('should log once and return an empty set when the fetch fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    stub.reply(() => ({ status: 403, body: { message: 'Resource not accessible' } }));

    expect((await getViewerTeams(state)).size).toBe(0);
    expect((await getViewerTeams(state)).size).toBe(0);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('Cannot read your GitHub teams');
    expect(log.mock.calls[0][0]).toContain('read:org or repo scope');
  });
});
