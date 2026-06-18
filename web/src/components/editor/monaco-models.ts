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
