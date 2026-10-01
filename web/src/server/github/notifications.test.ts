import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAppState } from '../trpc/context';
import { markThreadDoneOnGithub, markThreadReadOnGithub } from './notifications';
import { startStubGithub, type StubGithub } from './stub-server';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

describe('github notifications', () => {
  let stub: StubGithub;

  beforeEach(async () => {
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = TOKEN;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  it('should PATCH the thread to mark it read', async () => {
    stub.reply(() => ({ status: 205 }));

    await markThreadReadOnGithub(createAppState(), '7');

    expect(stub.requests[0]).toMatchObject({ method: 'PATCH', url: '/notifications/threads/7' });
  });

  it('should DELETE the thread to mark it done', async () => {
    stub.reply(() => ({ status: 204 }));

    await markThreadDoneOnGithub(createAppState(), '7');

    expect(stub.requests[0]).toMatchObject({ method: 'DELETE', url: '/notifications/threads/7' });
  });

  it('should log a redacted error and resolve when GitHub fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    stub.reply(() => ({ status: 403, body: { message: `denied ${TOKEN}` } }));

    await expect(markThreadDoneOnGithub(createAppState(), '7')).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0][0])).not.toContain(TOKEN);
  });
});
