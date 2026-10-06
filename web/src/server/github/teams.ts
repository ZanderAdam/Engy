import type { AppState } from '../trpc/context';
import { githubRestPaginated } from './client';
import { redactSecrets } from './errors';

export const TEAMS_REFRESH_MS = 60 * 60 * 1000;

interface GithubTeam {
  slug: string;
  organization: { login: string };
}

export async function getViewerTeams(state: AppState): Promise<ReadonlySet<string>> {
  const cached = state.github.teams;
  if (cached && Date.now() - cached.fetchedAt < TEAMS_REFRESH_MS) return cached.keys;

  let keys: Set<string>;
  try {
    const teams = await githubRestPaginated<GithubTeam>(state, '/user/teams?per_page=100');
    keys = new Set(teams.map((team) => `${team.organization.login}/${team.slug}`.toLowerCase()));
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replace(/\.+$/, '');
    console.error(
      `[inbox] Cannot read your GitHub teams: ${redactSecrets(reason)}. Team review requests will not show in the Inbox. Give the token the read:org or repo scope.`,
    );
    keys = new Set();
  }
  state.github.teams = { keys, fetchedAt: Date.now() };
  return keys;
}
