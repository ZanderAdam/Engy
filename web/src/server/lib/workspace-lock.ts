const chains = new Map<string, Promise<unknown>>();

/**
 * Serializes async operations per workspace directory. Git operations on a
 * workspace dir (add/commit from memory writes, README regeneration,
 * auto-linking) must not interleave — concurrent `git commit` processes fail
 * with "another git process seems to be running" and leave
 * staged-but-uncommitted state.
 *
 * Not reentrant: never call withWorkspaceLock inside `fn` with the same key —
 * the inner call would wait on the outer chain and deadlock.
 */
export async function withWorkspaceLock<T>(
  workspaceDir: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = chains.get(workspaceDir) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  chains.set(
    workspaceDir,
    next.catch(() => undefined),
  );
  return next;
}
