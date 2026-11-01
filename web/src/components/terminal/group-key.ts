/**
 * Single source of truth for terminal session group keys. Keeping the format
 * encoded in one place prevents per-tab terminal isolation from silently
 * breaking when one call site drifts from another.
 */
const WORKTREE_SEPARATOR = ':wt:';
const SHELL_PREFIX = 'shell:';

export function projectGroupKey(
  workspaceSlug: string,
  projectSlug: string,
  worktreeBranch?: string,
): string {
  const base = `project:${workspaceSlug}:${projectSlug}`;
  return worktreeBranch ? `${base}${WORKTREE_SEPARATOR}${worktreeBranch}` : base;
}

/**
 * The `?wt` value of the page that hosts a session. A session's `worktreeBranch`
 * cannot answer this: a main-checkout session reports its live branch there.
 */
export function worktreeFromGroupKey(groupKey: string | undefined): string | undefined {
  return groupKey?.split(WORKTREE_SEPARATOR)[1];
}

export function shellGroupKey(groupKey: string): string {
  return `${SHELL_PREFIX}${groupKey}`;
}

export function isShellGroupKey(groupKey: string | undefined): boolean {
  return groupKey?.startsWith(SHELL_PREFIX) ?? false;
}

export function workspaceGroupKey(workspaceSlug: string): string {
  return `workspace:${workspaceSlug}`;
}

/** Normalize a raw `?wt` URL value to undefined for null/empty strings. */
export function normalizeWtParam(raw: string | null | undefined): string | undefined {
  return raw && raw.length > 0 ? raw : undefined;
}

interface ParsedGroupKey {
  shell: boolean;
  workspaceSlug: string;
  projectSlug?: string;
  worktreeBranch?: string;
}

export function parseGroupKey(groupKey: string): ParsedGroupKey | undefined {
  const shell = groupKey.startsWith(SHELL_PREFIX);
  const key = shell ? groupKey.slice(SHELL_PREFIX.length) : groupKey;

  if (key.startsWith('project:')) {
    const wtIndex = key.indexOf(WORKTREE_SEPARATOR);
    const head = wtIndex < 0 ? key : key.slice(0, wtIndex);
    const [, workspaceSlug, projectSlug] = head.split(':');
    if (!workspaceSlug || !projectSlug) return undefined;
    const worktreeBranch = wtIndex < 0 ? undefined : key.slice(wtIndex + WORKTREE_SEPARATOR.length);
    return { shell, workspaceSlug, projectSlug, ...(worktreeBranch ? { worktreeBranch } : {}) };
  }

  for (const prefix of ['workspace:', 'worktree:']) {
    if (key.startsWith(prefix) && key.length > prefix.length) {
      return { shell, workspaceSlug: key.slice(prefix.length) };
    }
  }
  return undefined;
}
