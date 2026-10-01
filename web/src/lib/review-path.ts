export function buildReviewPath(
  workspaceSlug: string,
  repoFullName: string,
  prNumber: number,
  projectSlug?: string | null,
): string {
  const params = new URLSearchParams({ repo: repoFullName, pr: String(prNumber) });
  if (projectSlug) params.set('project', projectSlug);
  return `/w/${workspaceSlug}/review?${params.toString()}`;
}
