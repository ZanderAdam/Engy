/**
 * Single source of truth for terminal session group keys. Keeping the format
 * encoded in one place prevents per-tab terminal isolation from silently
 * breaking when one call site drifts from another.
 */
export function projectGroupKey(
  workspaceSlug: string,
  projectSlug: string,
  worktreeBranch?: string,
): string {
  const base = `project:${workspaceSlug}:${projectSlug}`;
  return worktreeBranch ? `${base}:wt:${worktreeBranch}` : base;
}

/**
 * The worktree a session was opened against, read back out of its group key.
 * `scope.worktreeBranch` cannot answer this: it is overwritten by the branch
 * the session's tracked directory resolves to, and a project terminal runs in
 * the project's docs directory, whose `HEAD` belongs to another repo entirely.
 */
export function worktreeBranchFromGroupKey(groupKey: string): string | undefined {
  const marker = groupKey.indexOf(':wt:');
  if (marker < 0) return undefined;
  return groupKey.slice(marker + ':wt:'.length) || undefined;
}

export function workspaceGroupKey(workspaceSlug: string): string {
  return `workspace:${workspaceSlug}`;
}

/** Normalize a raw `?wt` URL value to undefined for null/empty strings. */
export function normalizeWtParam(raw: string | null | undefined): string | undefined {
  return raw && raw.length > 0 ? raw : undefined;
}
