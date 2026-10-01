import { diffDocFilePath } from '@/lib/diff-doc-path';
import type { DiffComment } from './use-diff-comments';

export function scopeCommentsToFiles(
  comments: DiffComment[],
  files: Array<{ path: string }>,
): { inScope: DiffComment[]; outOfScope: DiffComment[]; unresolvedByFile: Map<string, number> } {
  const filePaths = new Set(files.map((f) => f.path));
  const inScope: DiffComment[] = [];
  const outOfScope: DiffComment[] = [];
  const unresolvedByFile = new Map<string, number>();

  for (const comment of comments) {
    const filePath = diffDocFilePath(comment.documentPath);
    if (!filePath) continue;
    if (!filePaths.has(filePath)) {
      outOfScope.push(comment);
      continue;
    }
    inScope.push(comment);
    if (!comment.resolved) {
      unresolvedByFile.set(filePath, (unresolvedByFile.get(filePath) ?? 0) + 1);
    }
  }

  return { inScope, outOfScope, unresolvedByFile };
}
