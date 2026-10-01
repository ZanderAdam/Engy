import { describe, it, expect } from 'vitest';
import { scopeCommentsToFiles } from './comment-scope';
import { diffDocPath } from '@/lib/diff-doc-path';
import type { DiffComment } from './use-diff-comments';

function thread(filePath: string, resolved = false): DiffComment {
  return {
    threadId: `${filePath}-${resolved}`,
    documentPath: diffDocPath('/repo', 'feature/x', filePath),
    lineNumber: 1,
    codeLine: '',
    side: 'modified',
    resolved,
    source: 'local',
    comments: [],
  };
}

describe('scopeCommentsToFiles', () => {
  it('should keep only threads on files in the diff', () => {
    const { inScope } = scopeCommentsToFiles(
      [thread('a.ts'), thread('other.ts')],
      [{ path: 'a.ts' }],
    );
    expect(inScope.map((c) => c.documentPath)).toEqual([thread('a.ts').documentPath]);
  });

  it('should return threads on files outside the diff separately', () => {
    const { outOfScope } = scopeCommentsToFiles(
      [thread('a.ts'), thread('other.ts')],
      [{ path: 'a.ts' }],
    );
    expect(outOfScope.map((c) => c.documentPath)).toEqual([thread('other.ts').documentPath]);
  });

  it('should count unresolved threads per file', () => {
    const { unresolvedByFile } = scopeCommentsToFiles(
      [thread('a.ts'), thread('a.ts'), thread('a.ts', true), thread('b.ts', true)],
      [{ path: 'a.ts' }, { path: 'b.ts' }],
    );
    expect(unresolvedByFile.get('a.ts')).toBe(2);
    expect(unresolvedByFile.has('b.ts')).toBe(false);
  });

  it('should skip the repo-wide summary thread', () => {
    const summary = { ...thread('x'), documentPath: diffDocPath('/repo', 'feature/x', '') };
    expect(scopeCommentsToFiles([summary], [{ path: 'a.ts' }]).inScope).toEqual([]);
  });
});
