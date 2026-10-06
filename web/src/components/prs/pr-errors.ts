type GlobalPrError = 'no-daemon';

interface RepoPrError {
  repo: string;
  message: string;
}

interface ClassifiedPrErrors {
  global: GlobalPrError | null;
  perRepo: RepoPrError[];
}

/**
 * Splits per-repo errors into a single global state vs inline per-repo rows.
 * A missing daemon can't differ per repo, so it collapses to a global banner.
 * Other errors, such as a repo without a GitHub remote, stay per-repo.
 */
export function classifyPrRepoErrors(repoErrors: Record<string, string>): ClassifiedPrErrors {
  const entries = Object.entries(repoErrors);
  if (entries.length === 0) return { global: null, perRepo: [] };

  // The daemon is global too — any daemon error means all repos are unreachable,
  // even when stale per-repo errors from before the disconnect are still recorded.
  if (entries.some(([, error]) => error.toLowerCase().includes('daemon'))) {
    return { global: 'no-daemon', perRepo: [] };
  }

  return {
    global: null,
    perRepo: entries.map(([repo, error]) => ({ repo, message: error })),
  };
}

/** Short display name for a repo path (last path segment). */
export function repoDisplayName(repo: string): string {
  return repo.split('/').pop() ?? repo;
}
