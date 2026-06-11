/**
 * Normalise a memory filePath to a workspace-relative forward-slash path.
 *
 * The server stores filePath as workspace-relative (e.g. "memory/decisions/foo.md"),
 * produced by path.relative(workspaceDir, absPath).replace(/\\/g, '/').
 * This helper is a defensive client-side guard: it strips any leading absolute
 * path prefix and ensures forward slashes, so linkedMemories contains only
 * clean relative paths regardless of the OS that wrote the record.
 */
export function toRelativeMemoryPath(filePath: string): string {
  // Normalise backslashes first.
  const normalised = filePath.replace(/\\/g, '/');

  // If it looks absolute (starts with / or e.g. C:/), extract the memory/...
  // suffix which is the workspace-relative portion.
  const memoryIndex = normalised.indexOf('memory/');
  if (memoryIndex > 0) {
    return normalised.slice(memoryIndex);
  }

  return normalised;
}
