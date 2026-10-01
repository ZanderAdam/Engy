import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createAppState } from '../trpc/context';
import {
  fetchNotifications,
  markThreadDoneOnGithub,
  markThreadReadOnGithub,
} from './notifications';
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

describe('fetchNotifications', () => {
  let stub: StubGithub;

  beforeEach(async () => {
    stub = await startStubGithub();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = TOKEN;
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  const thread = (id: string) => ({ id, unread: true });

  it('should request unread only on first run', async () => {
    stub.reply(() => ({ body: [] }));

    await fetchNotifications(createAppState());

    expect(stub.requests[0].url).toBe('/notifications?all=false&per_page=50');
  });

  it('should send since and If-Modified-Since and return poll interval', async () => {
    stub.reply(() => ({
      headers: { 'last-modified': 'Wed, 01 Jan 2026 00:00:00 GMT', 'x-poll-interval': '120' },
      body: [thread('1')],
    }));

    const result = await fetchNotifications(createAppState(), {
      since: '2026-01-01T00:00:00.000Z',
      ifModifiedSince: 'Tue, 31 Dec 2025 00:00:00 GMT',
    });

    expect(stub.requests[0].url).toBe(
      '/notifications?all=true&per_page=50&since=2026-01-01T00%3A00%3A00.000Z',
    );
    expect(stub.requests[0].headers['if-modified-since']).toBe('Tue, 31 Dec 2025 00:00:00 GMT');
    expect(result).toMatchObject({
      status: 'ok',
      lastModified: 'Wed, 01 Jan 2026 00:00:00 GMT',
      pollIntervalSeconds: 120,
    });
  });

  it('should return not_modified on 304', async () => {
    stub.reply(() => ({ status: 304 }));

    expect(await fetchNotifications(createAppState())).toEqual({ status: 'not_modified' });
  });

  it('should follow pagination links', async () => {
    stub.reply((req) =>
      req.url.includes('page=2')
        ? { body: [thread('2')] }
        : {
            headers: { link: `<${stub.url}/notifications?page=2>; rel="next"` },
            body: [thread('1')],
          },
    );

    const result = await fetchNotifications(createAppState());

    expect(result.status === 'ok' && result.notifications.map((n) => n.id)).toEqual(['1', '2']);
  });
});
