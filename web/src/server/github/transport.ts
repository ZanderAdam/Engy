import type { AppState } from '../trpc/context';
import { GithubError, redactSecrets, type GithubErrorKind } from './errors';

export const RATE_LIMIT_FLOOR = 50;
const DEFAULT_API_URL = 'https://api.github.com';
const DEFAULT_RETRY_AFTER_MS = 60_000;

export const MISSING_TOKEN_MESSAGE =
  'Set ENGY_GITHUB_TOKEN in .env (dev: .dev.env). Create it with `gh auth token`.';

export interface GithubRequest {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Path under the API root, or an absolute URL on the same origin (pagination links). */
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface GithubResponse {
  status: number;
  headers: Headers;
  body: unknown;
}

function apiUrl(): string {
  return (process.env.ENGY_GITHUB_API_URL ?? DEFAULT_API_URL).replace(/\/+$/, '');
}

function resolveUrl(path: string): string {
  const base = apiUrl();
  if (!/^https?:\/\//i.test(path)) return `${base}${path}`;
  if (new URL(path).origin !== new URL(base).origin) {
    throw new GithubError('validation', `Refusing to send the GitHub token to ${path}`);
  }
  return path;
}

function rateLimitResource(path: string): string {
  return /^(https?:\/\/[^/]+)?\/graphql(\?|$)/.test(path) ? 'graphql' : 'core';
}

function recordRateLimit(state: AppState, headers: Headers, fallbackResource: string): void {
  const remaining = headers.get('x-ratelimit-remaining');
  const reset = headers.get('x-ratelimit-reset');
  if (remaining === null || reset === null) return;
  const resource = headers.get('x-ratelimit-resource') ?? fallbackResource;
  state.github.rateLimits.set(resource, {
    remaining: Number(remaining),
    resetAt: Number(reset) * 1000,
  });
}

function assertWithinRateLimit(state: AppState, resource: string): void {
  const limit = state.github.rateLimits.get(resource);
  if (!limit || limit.remaining >= RATE_LIMIT_FLOOR || limit.resetAt <= Date.now()) return;
  throw new GithubError(
    'rate_limited',
    `GitHub rate limit low (${limit.remaining} left); backing off until ${new Date(limit.resetAt).toISOString()}`,
    { resetAt: limit.resetAt },
  );
}

function retryAt(headers: Headers): number {
  const retryAfter = headers.get('retry-after');
  if (retryAfter) return Date.now() + Number(retryAfter) * 1000;
  const reset = headers.get('x-ratelimit-reset');
  if (reset) return Number(reset) * 1000;
  return Date.now() + DEFAULT_RETRY_AFTER_MS;
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object' && 'message' in body) {
    const { message } = body as { message: unknown };
    if (typeof message === 'string') return message;
  }
  return fallback;
}

function toGithubError(res: GithubResponse): GithubError {
  const { status, headers, body } = res;
  const message = errorMessage(body, `GitHub responded with HTTP ${status}`);
  const details = { httpStatus: status };

  const isRateLimited =
    status === 429 ||
    (status === 403 &&
      (headers.get('x-ratelimit-remaining') === '0' ||
        headers.has('retry-after') ||
        /rate limit/i.test(message)));
  if (isRateLimited) {
    return new GithubError('rate_limited', message, { ...details, resetAt: retryAt(headers) });
  }

  let kind: GithubErrorKind;
  if (status === 401) kind = 'unauthorized';
  else if (status === 403) kind = 'forbidden';
  else if (status === 404) kind = 'not_found';
  else if (status >= 500) kind = 'network';
  else kind = 'validation';
  return new GithubError(kind, message, details);
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function githubTransport(
  state: AppState,
  request: GithubRequest,
): Promise<GithubResponse> {
  const token = process.env.ENGY_GITHUB_TOKEN;
  if (!token) throw new GithubError('unauthorized', MISSING_TOKEN_MESSAGE);
  const resource = rateLimitResource(request.path);
  assertWithinRateLimit(state, resource);

  const url = resolveUrl(request.path);
  const hasBody = request.body !== undefined;
  let res: Response;
  try {
    res = await fetch(url, {
      method: request.method ?? 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'engy',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...request.headers,
      },
      body: hasBody ? JSON.stringify(request.body) : undefined,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new GithubError('network', `GitHub request failed: ${redactSecrets(reason)}`);
  }

  recordRateLimit(state, res.headers, resource);
  const response: GithubResponse = {
    status: res.status,
    headers: res.headers,
    body: res.status === 304 ? null : await readBody(res),
  };
  if (res.status === 304 || res.ok) return response;
  const error = toGithubError(response);
  if (error.kind === 'rate_limited' && error.resetAt !== null) {
    state.github.rateLimits.set(resource, { remaining: 0, resetAt: error.resetAt });
  }
  throw error;
}
