/**
 * Builds a stable, collision-free path for a file's Monaco model URI. The repo
 * root is folded into the path so the same relative file under two different
 * repos/worktrees gets distinct models. Pure for unit testing.
 *
 * @monaco-editor/react keys its model + view-state cache on this path, which is
 * what preserves each file's cursor, scroll, undo history and language-service
 * model as the user switches between tabs.
 */
export function buildModelPath(repoRoot: string, relPath: string): string {
  const root = repoRoot.replace(/^\/+|\/+$/g, '');
  const rel = relPath.replace(/^\/+/, '');
  return `/${root}/${rel}`;
}

/**
 * Namespaces a file's model path so distinct editor surfaces (e.g. the code page
 * vs. a diff view) never share a Monaco model for the same file. The
 * @monaco-editor/react model cache is module-global and keyed only on path.
 */
export function namespacedModelPath(namespace: string, repoRoot: string, relPath: string): string {
  return `${namespace}:${buildModelPath(repoRoot, relPath)}`;
}
