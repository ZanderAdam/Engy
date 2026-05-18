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

export function workspaceGroupKey(workspaceSlug: string): string {
  return `workspace:${workspaceSlug}`;
}

/** Normalize a raw `?wt` URL value to undefined for null/empty strings. */
export function normalizeWtParam(raw: string | null | undefined): string | undefined {
  return raw && raw.length > 0 ? raw : undefined;
}
