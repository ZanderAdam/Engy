export function repoName(repoDir: string): string {
  return repoDir.split('/').filter(Boolean).pop() ?? repoDir;
}

/**
 * How a repo is written into a link. The name, unless the workspace holds a
 * second repo with the same directory name — then only the path is unambiguous.
 */
export function repoLinkValue(repoDir: string, repos: string[]): string {
  const name = repoName(repoDir);
  return repos.filter((repo) => repoName(repo) === name).length > 1 ? repoDir : name;
}

export function repoDirByName(repos: string[], value: string): string | null {
  return repos.find((repo) => repo === value || repoName(repo) === value) ?? null;
}
