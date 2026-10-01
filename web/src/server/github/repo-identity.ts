import type { AppState } from '../trpc/context';
import { dispatchGitRemoteUrl } from '../ws/server';

const GITHUB_REMOTE_PATTERNS = [
  /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
  /^(?:ssh|https?|git):\/\/(?:[^@/\s]+@)?github\.com(?::\d+)?\/([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/,
];

export function parseGithubRemote(url: string): string | null {
  const trimmed = url.trim();
  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = pattern.exec(trimmed);
    if (match) return `${match[1]}/${match[2]}`;
  }
  return null;
}

export async function resolveRepoFullName(
  state: AppState,
  repoPath: string,
): Promise<string | null> {
  const cached = state.repoFullNames.get(repoPath);
  if (cached !== undefined) return cached;

  const { url } = await dispatchGitRemoteUrl(repoPath, state);
  if (url === null) return null;

  const fullName = parseGithubRemote(url);
  state.repoFullNames.set(repoPath, fullName);
  return fullName;
}
