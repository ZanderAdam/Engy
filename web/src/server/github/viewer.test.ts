import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { getGithubStatus, refreshGithubStatus } from './viewer';
import { startStubGithub, type StubGithub } from './stub-server';

const CLASSIC_TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

describe('github viewer status', () => {
  let stub: StubGithub;
  let state: AppState;

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = CLASSIC_TOKEN;
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  it('should report the setup instructions when the token is missing', async () => {
    delete process.env.ENGY_GITHUB_TOKEN;

    const status = await refreshGithubStatus(state);

    expect(status).toEqual({
      available: false,
      reason: 'missing_token',
      message: 'Set ENGY_GITHUB_TOKEN in .env (dev: .dev.env). Create it with `gh auth token`.',
    });
    expect(stub.requests).toHaveLength(0);
  });

  it('should cache the viewer login and scopes for a valid token', async () => {
    stub.reply(() => ({
      body: { login: 'octo' },
      headers: { 'x-oauth-scopes': 'gist, notifications, repo' },
    }));

    const status = await refreshGithubStatus(state);

    expect(status).toEqual({ available: true, login: 'octo' });
    expect(state.github.viewer).toEqual({
      login: 'octo',
      scopes: ['gist', 'notifications', 'repo'],
    });
    expect(state.github.status).toEqual(status);
  });

  it('should report a rejected token', async () => {
    stub.reply(() => ({ status: 401, body: { message: 'Bad credentials' } }));

    const status = await refreshGithubStatus(state);

    expect(status).toMatchObject({ available: false, reason: 'rejected_token' });
    expect(state.github.viewer).toBeNull();
  });

  it('should name the missing scope', async () => {
    stub.reply(() => ({ body: { login: 'octo' }, headers: { 'x-oauth-scopes': 'repo, gist' } }));

    const status = await refreshGithubStatus(state);

    expect(status).toMatchObject({
      available: false,
      reason: 'missing_scope',
      missingScopes: ['notifications'],
    });
    expect(status.available === false && status.message).toContain('notifications');
  });

  it('should reject a fine-grained token by prefix without calling GitHub', async () => {
    process.env.ENGY_GITHUB_TOKEN = `github_pat_${'A'.repeat(40)}`;

    const status = await refreshGithubStatus(state);

    expect(status).toMatchObject({ available: false, reason: 'fine_grained_token' });
    expect(status.available === false && status.message).toContain('Notifications API');
    expect(stub.requests).toHaveLength(0);
  });

  it('should treat a missing X-OAuth-Scopes header as a fine-grained token', async () => {
    stub.reply(() => ({ body: { login: 'octo' } }));

    const status = await refreshGithubStatus(state);

    expect(status).toMatchObject({ available: false, reason: 'fine_grained_token' });
  });

  it('should share one GET /user between concurrent callers', async () => {
    stub.reply(() => ({
      body: { login: 'octo' },
      headers: { 'x-oauth-scopes': 'repo, notifications' },
    }));

    await Promise.all([refreshGithubStatus(state), refreshGithubStatus(state)]);

    expect(stub.requests).toHaveLength(1);
  });

  it('should serve the cached status and retry after an unreachable result', async () => {
    stub.reply(() => ({ status: 502 }));
    const first = await getGithubStatus(state);
    expect(first).toMatchObject({ available: false, reason: 'unreachable' });

    stub.reply(() => ({
      body: { login: 'octo' },
      headers: { 'x-oauth-scopes': 'repo, notifications' },
    }));
    const second = await getGithubStatus(state);
    expect(second).toEqual({ available: true, login: 'octo' });

    await getGithubStatus(state);
    expect(stub.requests).toHaveLength(2);
  });

  it('should keep the token out of the status message', async () => {
    stub.reply(() => ({ status: 500, body: { message: `oops ${CLASSIC_TOKEN}` } }));

    const status = await refreshGithubStatus(state);

    expect(JSON.stringify(status)).not.toContain(CLASSIC_TOKEN);
  });
});
