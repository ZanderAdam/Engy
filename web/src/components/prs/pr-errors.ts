export type GlobalPrError = 'gh-not-installed' | 'no-daemon';

export interface RepoPrError {
  repo: string;
  kind: 'gh-not-authenticated' | 'generic';
  message: string;
}

export interface ClassifiedPrErrors {
  global: GlobalPrError | null;
  perRepo: RepoPrError[];
}

/**
 * Splits per-repo gh errors into a single global state vs inline per-repo rows.
 * gh-not-installed and no-daemon can't differ per repo (one binary, one daemon),
 * so they collapse to a global banner; auth and other errors stay per-repo
 * (auth is per-host — a GitHub Enterprise remote can fail while github.com works).
 */
export function classifyPrRepoErrors(repoErrors: Record<string, string>): ClassifiedPrErrors {
  const entries = Object.entries(repoErrors);
  if (entries.length === 0) return { global: null, perRepo: [] };

  if (entries.some(([, error]) => error === 'gh-not-installed')) {
    return { global: 'gh-not-installed', perRepo: [] };
  }
  // The daemon is global too — any daemon error means all repos are unreachable,
  // even when stale per-repo errors from before the disconnect are still recorded.
  if (entries.some(([, error]) => error.toLowerCase().includes('daemon'))) {
    return { global: 'no-daemon', perRepo: [] };
  }

  return {
    global: null,
    perRepo: entries.map(([repo, error]) => ({
      repo,
      kind: error === 'gh-not-authenticated' ? 'gh-not-authenticated' : 'generic',
      message: error,
    })),
  };
}

/** Short display name for a repo path (last path segment). */
export function repoDisplayName(repo: string): string {
  return repo.split('/').pop() ?? repo;
}
