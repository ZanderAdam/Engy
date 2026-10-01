import type { AppState } from '../trpc/context';
import { GithubError } from './errors';
import { githubTransport, type GithubRequest, type GithubResponse } from './transport';
import { refreshGithubStatus } from './viewer';

type GithubResult<T> =
  | {
      status: 'ok';
      data: T;
      etag: string | null;
      lastModified: string | null;
      nextUrl: string | null;
      headers: Headers;
    }
  | { status: 'not_modified' };

interface GithubRestOptions {
  method?: GithubRequest['method'];
  body?: unknown;
  ifNoneMatch?: string;
  ifModifiedSince?: string;
  headers?: Record<string, string>;
}

interface GraphqlError {
  type?: string;
  message: string;
}

const DEFAULT_MAX_PAGES = 10;

export function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(linkHeader);
  return match ? match[1] : null;
}

async function send(state: AppState, request: GithubRequest): Promise<GithubResponse> {
  try {
    return await githubTransport(state, request);
  } catch (error) {
    if (error instanceof GithubError && error.kind === 'unauthorized') {
      await refreshGithubStatus(state);
    }
    throw error;
  }
}

export async function githubRest<T = unknown>(
  state: AppState,
  path: string,
  options: GithubRestOptions = {},
): Promise<GithubResult<T>> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.ifNoneMatch) headers['If-None-Match'] = options.ifNoneMatch;
  if (options.ifModifiedSince) headers['If-Modified-Since'] = options.ifModifiedSince;

  const res = await send(state, { method: options.method, path, body: options.body, headers });
  if (res.status === 304) return { status: 'not_modified' };
  return {
    status: 'ok',
    data: res.body as T,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    nextUrl: parseNextLink(res.headers.get('link')),
    headers: res.headers,
  };
}

export async function githubRestPaginated<T>(
  state: AppState,
  path: string,
  options: { maxPages?: number } = {},
): Promise<T[]> {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const items: T[] = [];
  let next: string | null = path;
  for (let page = 0; next && page < maxPages; page++) {
    const result: GithubResult<T[]> = await githubRest<T[]>(state, next);
    if (result.status === 'not_modified') break;
    items.push(...result.data);
    next = result.nextUrl;
  }
  return items;
}

export async function githubGraphql<T = unknown>(
  state: AppState,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const res = await send(state, { method: 'POST', path: '/graphql', body: { query, variables } });
  const payload = res.body as { data?: T; errors?: GraphqlError[] };
  if (payload.errors?.length) {
    const message = payload.errors.map((e) => e.message).join('; ');
    switch (payload.errors[0].type) {
      case 'NOT_FOUND':
        throw new GithubError('not_found', message);
      case 'RATE_LIMITED':
        throw new GithubError('rate_limited', message, {
          resetAt: state.github.rateLimit?.resetAt,
        });
      default:
        throw new GithubError('validation', message);
    }
  }
  return payload.data as T;
}
