interface PrRef {
  repoFullName: string;
  prNumber: number;
}

export function buildPrsPath(
  workspaceSlug: string,
  projectSlug: string,
  pr: PrRef | null,
  currentSearch?: URLSearchParams,
): string {
  const params = new URLSearchParams(currentSearch);
  params.delete('repo');
  params.delete('pr');
  if (pr) {
    params.set('repo', pr.repoFullName);
    params.set('pr', String(pr.prNumber));
  }
  const query = params.toString();
  const base = `/w/${workspaceSlug}/projects/${projectSlug}/prs`;
  return query ? `${base}?${query}` : base;
}
