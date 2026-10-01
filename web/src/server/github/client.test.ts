import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createAppState, type AppState } from '../trpc/context';
import { GithubError, redactSecrets } from './errors';
import { githubGraphql, githubRest, githubRestPaginated, parseNextLink } from './client';
import { RATE_LIMIT_FLOOR } from './transport';
import { startStubGithub, type StubGithub } from './stub-server';

const TOKEN = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';

async function caught(promise: Promise<unknown>): Promise<GithubError> {
  try {
    await promise;
  } catch (error) {
    return error as GithubError;
  }
  throw new Error('expected the promise to reject');
}

describe('github client', () => {
  let stub: StubGithub;
  let state: AppState;

  beforeEach(async () => {
    stub = await startStubGithub();
    state = createAppState();
    process.env.ENGY_GITHUB_API_URL = stub.url;
    process.env.ENGY_GITHUB_TOKEN = TOKEN;
  });

  afterEach(async () => {
    delete process.env.ENGY_GITHUB_API_URL;
    delete process.env.ENGY_GITHUB_TOKEN;
    await stub.close();
  });

  describe('githubRest', () => {
    it('should send the token and return the parsed body', async () => {
      stub.reply(() => ({ body: { login: 'octo' }, headers: { etag: '"abc"' } }));

      const result = await githubRest<{ login: string }>(state, '/user');

      expect(result).toMatchObject({ status: 'ok', data: { login: 'octo' }, etag: '"abc"' });
      expect(stub.requests[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    });

    it('should return not_modified when GitHub answers 304 to a conditional request', async () => {
      stub.reply(() => ({ status: 304 }));

      const result = await githubRest(state, '/notifications', {
        ifNoneMatch: '"abc"',
        ifModifiedSince: 'Wed, 01 Jan 2025 00:00:00 GMT',
      });

      expect(result).toEqual({ status: 'not_modified' });
      expect(stub.requests[0].headers['if-none-match']).toBe('"abc"');
      expect(stub.requests[0].headers['if-modified-since']).toBe('Wed, 01 Jan 2025 00:00:00 GMT');
    });

    it('should return last-modified so callers can send it back', async () => {
      stub.reply(() => ({
        body: [],
        headers: { 'last-modified': 'Wed, 01 Jan 2025 00:00:00 GMT' },
      }));

      const result = await githubRest(state, '/notifications');

      expect(result).toMatchObject({ lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT' });
    });

    it('should send a JSON body for writes', async () => {
      stub.reply(() => ({ status: 201, body: { id: 1 } }));

      await githubRest(state, '/repos/o/r/issues', { method: 'POST', body: { title: 'x' } });

      expect(stub.requests[0].method).toBe('POST');
      expect(JSON.parse(stub.requests[0].body)).toEqual({ title: 'x' });
    });

    it('should refuse to send the token to a different origin', async () => {
      const error = await caught(githubRest(state, 'http://evil.example/steal'));

      expect(error.kind).toBe('validation');
      expect(stub.requests).toHaveLength(0);
    });
  });

  describe('typed errors', () => {
    it.each([
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [422, 'validation'],
      [429, 'rate_limited'],
      [502, 'network'],
    ])('should map HTTP %i to %s', async (status, kind) => {
      stub.reply(() => ({ status, body: { message: 'nope' } }));

      const error = await caught(githubRest(state, '/x'));

      expect(error).toBeInstanceOf(GithubError);
      expect(error.kind).toBe(kind);
      expect(error.httpStatus).toBe(status);
    });

    it('should map a 403 with an exhausted budget to rate_limited with a reset time', async () => {
      stub.reply(() => ({
        status: 403,
        body: { message: 'API rate limit exceeded' },
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '4102444800' },
      }));

      const error = await caught(githubRest(state, '/x'));

      expect(error.kind).toBe('rate_limited');
      expect(error.resetAt).toBe(4102444800 * 1000);
    });

    it('should map a refused connection to network', async () => {
      await stub.close();

      const error = await caught(githubRest(state, '/x'));

      expect(error.kind).toBe('network');
      stub = await startStubGithub();
    });

    it('should redact the token from error text', async () => {
      stub.reply(() => ({ status: 400, body: { message: `bad credentials ${TOKEN}` } }));

      const error = await caught(githubRest(state, '/x'));

      expect(error.message).not.toContain(TOKEN);
      expect(error.message).toContain('[redacted]');
    });

    it('should refuse to run without a token', async () => {
      delete process.env.ENGY_GITHUB_TOKEN;

      const error = await caught(githubRest(state, '/x'));

      expect(error.kind).toBe('unauthorized');
      expect(error.message).toContain('ENGY_GITHUB_TOKEN');
      expect(stub.requests).toHaveLength(0);
    });
  });

  describe('401 handling', () => {
    it('should re-check GET /user after a 401', async () => {
      stub.reply((req) =>
        req.url === '/user'
          ? { status: 401, body: { message: 'Bad credentials' } }
          : { status: 401 },
      );

      await caught(githubRest(state, '/repos/o/r'));

      expect(stub.requests.map((r) => r.url)).toEqual(['/repos/o/r', '/user']);
      expect(state.github.status).toMatchObject({ available: false, reason: 'rejected_token' });
    });
  });

  describe('rate limit', () => {
    it('should capture remaining and reset from response headers', async () => {
      stub.reply(() => ({
        body: {},
        headers: { 'x-ratelimit-remaining': '4321', 'x-ratelimit-reset': '4102444800' },
      }));

      await githubRest(state, '/x');

      expect(state.github.rateLimits.get('core')).toEqual({
        remaining: 4321,
        resetAt: 4102444800 * 1000,
      });
    });

    it('should back off without calling GitHub while below the floor', async () => {
      state.github.rateLimits.set('core', {
        remaining: RATE_LIMIT_FLOOR - 1,
        resetAt: Date.now() + 60_000,
      });

      const error = await caught(githubRest(state, '/x'));

      expect(error.kind).toBe('rate_limited');
      expect(error.resetAt).toBe(state.github.rateLimits.get('core')?.resetAt);
      expect(stub.requests).toHaveLength(0);
    });

    it('should track REST and GraphQL budgets separately', async () => {
      stub.reply((req) => ({
        body: req.url === '/graphql' ? { data: {} } : {},
        headers: {
          'x-ratelimit-remaining': req.url === '/graphql' ? '4000' : '2',
          'x-ratelimit-reset': '4102444800',
          'x-ratelimit-resource': req.url === '/graphql' ? 'graphql' : 'core',
        },
      }));

      await githubRest(state, '/x');
      await githubGraphql(state, '{ viewer { login } }');

      expect(state.github.rateLimits.get('core')?.remaining).toBe(2);
      expect(state.github.rateLimits.get('graphql')?.remaining).toBe(4000);
      const error = await caught(githubRest(state, '/y'));
      expect(error.kind).toBe('rate_limited');
      await expect(githubGraphql(state, '{ viewer { login } }')).resolves.toEqual({});
    });

    it('should back off after a secondary rate limit error', async () => {
      stub.reply(() => ({
        status: 403,
        body: { message: 'You have exceeded a secondary rate limit' },
        headers: { 'retry-after': '120' },
      }));
      await caught(githubRest(state, '/x'));
      stub.requests.length = 0;

      const error = await caught(githubRest(state, '/x'));

      expect(error.kind).toBe('rate_limited');
      expect(error.resetAt).toBeGreaterThan(Date.now() + 100_000);
      expect(stub.requests).toHaveLength(0);
    });

    it('should resume once the reset time has passed', async () => {
      state.github.rateLimits.set('core', { remaining: 0, resetAt: Date.now() - 1 });

      const result = await githubRest(state, '/x');

      expect(result.status).toBe('ok');
    });
  });

  describe('pagination', () => {
    it('should parse the next link from a Link header', () => {
      const header =
        '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=5>; rel="last"';

      expect(parseNextLink(header)).toBe('https://api.github.com/x?page=2');
      expect(parseNextLink('<https://api.github.com/x?page=1>; rel="prev"')).toBeNull();
      expect(parseNextLink(null)).toBeNull();
    });

    it('should follow next links and concatenate pages', async () => {
      stub.reply((req) => {
        if (req.url.endsWith('page=2')) return { body: [3] };
        const next = `<${stub.url}/items?page=2>; rel="next"`;
        return { body: [1, 2], headers: { link: next } };
      });

      const items = await githubRestPaginated<number>(state, '/items?per_page=100');

      expect(items).toEqual([1, 2, 3]);
      expect(stub.requests).toHaveLength(2);
    });

    it('should stop at maxPages', async () => {
      stub.reply(() => ({
        body: [1],
        headers: { link: `<${stub.url}/items?page=n>; rel="next"` },
      }));

      const items = await githubRestPaginated<number>(state, '/items', { maxPages: 3 });

      expect(items).toEqual([1, 1, 1]);
    });
  });

  describe('githubGraphql', () => {
    it('should post the query and return data', async () => {
      stub.reply(() => ({ body: { data: { viewer: { login: 'octo' } } } }));

      const data = await githubGraphql<{ viewer: { login: string } }>(state, 'query { viewer }', {
        a: 1,
      });

      expect(data.viewer.login).toBe('octo');
      expect(stub.requests[0].url).toBe('/graphql');
      expect(JSON.parse(stub.requests[0].body)).toEqual({
        query: 'query { viewer }',
        variables: { a: 1 },
      });
    });

    it.each([
      ['NOT_FOUND', 'not_found'],
      ['FORBIDDEN', 'forbidden'],
      ['INSUFFICIENT_SCOPES', 'forbidden'],
      ['RATE_LIMITED', 'rate_limited'],
      ['SOMETHING_ELSE', 'validation'],
    ])('should map GraphQL error type %s to %s', async (type, kind) => {
      stub.reply(() => ({ body: { errors: [{ type, message: 'boom' }] } }));

      const error = await caught(githubGraphql(state, 'query { x }'));

      expect(error.kind).toBe(kind);
    });
  });
});

describe('redactSecrets', () => {
  it('should strip known token formats', () => {
    const text = `a ghp_${'a'.repeat(30)} b github_pat_${'B'.repeat(30)} c Bearer abc.def-ghi`;

    expect(redactSecrets(text)).toBe('a [redacted] b [redacted] c [redacted]');
  });
});
