export type GithubUnavailableReason =
  | 'missing_token'
  | 'rejected_token'
  | 'missing_scope'
  | 'fine_grained_token'
  | 'unreachable';

export type GithubStatus =
  | { available: true; login: string }
  | {
      available: false;
      reason: GithubUnavailableReason;
      message: string;
      missingScopes?: string[];
    };

export interface GithubRateLimit {
  remaining: number;
  /** Epoch ms when the budget resets. */
  resetAt: number;
}

export interface GithubState {
  viewer: { login: string; scopes: string[] | null } | null;
  /** null until the first `GET /user` settles. */
  status: GithubStatus | null;
  /** Keyed by GitHub rate limit resource: `core`, `graphql`, `search`. */
  rateLimits: Map<string, GithubRateLimit>;
  viewerCheck: Promise<GithubStatus> | null;
  /** `org/slug` keys, lowercased; empty when the fetch failed. */
  teams: { keys: ReadonlySet<string>; fetchedAt: number } | null;
}

export function createGithubState(): GithubState {
  return { viewer: null, status: null, rateLimits: new Map(), viewerCheck: null, teams: null };
}
