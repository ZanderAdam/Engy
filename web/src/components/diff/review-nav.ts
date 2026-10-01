import { diffDocFilePath } from '@/lib/diff-doc-path';

interface ThreadLocation {
  threadId: string;
  documentPath: string;
  lineNumber: number;
  resolved: boolean;
}

export function stepInList<T>(items: T[], current: T | null, delta: 1 | -1): T | null {
  if (items.length === 0) return null;
  const index = current === null ? -1 : items.indexOf(current);
  if (index === -1) return delta === 1 ? items[0] : items[items.length - 1];
  return items[(index + delta + items.length) % items.length];
}

export function unresolvedThreadOrder<T extends ThreadLocation>(
  threads: T[],
  filePaths: string[],
): T[] {
  const fileIndex = new Map(filePaths.map((path, index) => [path, index]));
  const located: Array<{ thread: T; file: number }> = [];
  for (const thread of threads) {
    if (thread.resolved) continue;
    const path = diffDocFilePath(thread.documentPath);
    const file = path === null ? undefined : fileIndex.get(path);
    if (file !== undefined) located.push({ thread, file });
  }
  return located
    .sort((a, b) => a.file - b.file || a.thread.lineNumber - b.thread.lineNumber)
    .map(({ thread }) => thread);
}
