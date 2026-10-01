import type { AppState } from '../trpc/context';
import { GithubError } from './errors';
import { MISSING_TOKEN_MESSAGE, githubTransport } from './transport';
import type { GithubStatus, GithubUnavailableReason } from './types';

const REQUIRED_SCOPES = ['repo', 'notifications'];

const FINE_GRAINED_MESSAGE =
  'ENGY_GITHUB_TOKEN is a fine-grained token. The GitHub Notifications API does not accept fine-grained tokens. Use a classic token (`gh auth token`).';

function unavailable(
  reason: GithubUnavailableReason,
  message: string,
  missingScopes?: string[],
): GithubStatus {
  return { available: false, reason, message, ...(missingScopes ? { missingScopes } : {}) };
}

async function checkViewer(state: AppState): Promise<GithubStatus> {
  const token = process.env.ENGY_GITHUB_TOKEN;
  if (!token) return unavailable('missing_token', MISSING_TOKEN_MESSAGE);
  if (token.startsWith('github_pat_')) {
    return unavailable('fine_grained_token', FINE_GRAINED_MESSAGE);
  }

  try {
    const res = await githubTransport(state, { path: '/user' });
    const login = (res.body as { login: string }).login;
    const scopeHeader = res.headers.get('x-oauth-scopes');
    if (scopeHeader === null) {
      state.github.viewer = { login, scopes: null };
      return unavailable('fine_grained_token', FINE_GRAINED_MESSAGE);
    }

    const scopes = scopeHeader
      .split(',')
      .map((scope) => scope.trim())
      .filter(Boolean);
    state.github.viewer = { login, scopes };
    const missing = REQUIRED_SCOPES.filter((scope) => !scopes.includes(scope));
    if (missing.length > 0) {
      return unavailable(
        'missing_scope',
        `ENGY_GITHUB_TOKEN is missing the ${missing.join(' and ')} scope. Run \`gh auth refresh -s ${REQUIRED_SCOPES.join(',')}\`, then update the token.`,
        missing,
      );
    }
    return { available: true, login };
  } catch (error) {
    state.github.viewer = null;
    if (error instanceof GithubError && error.kind === 'unauthorized') {
      return unavailable(
        'rejected_token',
        'GitHub rejected ENGY_GITHUB_TOKEN. Create a new token.',
      );
    }
    const detail = error instanceof Error ? error.message : String(error);
    return unavailable('unreachable', `Could not reach GitHub: ${detail}`);
  }
}

/** Runs `GET /user` and caches viewer + status on AppState. Concurrent callers share one request. */
export function refreshGithubStatus(state: AppState): Promise<GithubStatus> {
  if (state.github.viewerCheck) return state.github.viewerCheck;
  const check = checkViewer(state)
    .then((status) => {
      state.github.status = status;
      return status;
    })
    .finally(() => {
      state.github.viewerCheck = null;
    });
  state.github.viewerCheck = check;
  return check;
}

/** Returns the cached status; re-checks on first call and after a transient failure. */
export async function getGithubStatus(state: AppState): Promise<GithubStatus> {
  const cached = state.github.status;
  if (cached && (cached.available || cached.reason !== 'unreachable')) return cached;
  return refreshGithubStatus(state);
}
