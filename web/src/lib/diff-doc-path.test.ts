import { describe, it, expect } from 'vitest';
import { diffDocPath, diffScopePrefix, diffDocFilePath, parseDiffDocPath } from './diff-doc-path';

const REPO = '/home/dev/proj';

describe('diff document paths', () => {
  describe('scoping', () => {
    it('[FR-GIT-480] should key a file on the repo and the branch under review', () => {
      expect(diffDocPath(REPO, 'main', 'src/a.ts')).toBe('diff:///home/dev/proj#main/src/a.ts');
    });

    it('[FR-GIT-480] should give two branches of one repo different paths for the same file', () => {
      expect(diffDocPath(REPO, 'main', 'src/a.ts')).not.toBe(
        diffDocPath(REPO, 'feature/x', 'src/a.ts'),
      );
    });

    it('[FR-GIT-480] should place the review summary at the scope prefix itself', () => {
      expect(diffScopePrefix(REPO, 'main')).toBe('diff:///home/dev/proj#main/');
      expect(diffDocFilePath(diffScopePrefix(REPO, 'main'))).toBeNull();
    });

    it("[FR-GIT-480] should not let one branch's prefix match another branch that extends its name", () => {
      const prefix = diffScopePrefix(REPO, 'feat');
      expect(diffDocPath(REPO, 'feature', 'src/a.ts').startsWith(prefix)).toBe(false);
    });
  });

  describe('parsing', () => {
    it('[FR-GIT-480] should recover repo, branch and file from a path', () => {
      expect(parseDiffDocPath(diffDocPath(REPO, 'feature/login', 'src/a.ts'))).toEqual({
        repoDir: REPO,
        branch: 'feature/login',
        filePath: 'src/a.ts',
      });
    });

    it('[FR-GIT-480] should keep a slash-bearing branch apart from the file path', () => {
      expect(diffDocFilePath(diffDocPath(REPO, 'feature/a/b', 'src/a.ts'))).toBe('src/a.ts');
    });

    it('[FR-GIT-480] should return null for a path that is not a diff path', () => {
      expect(parseDiffDocPath('/home/dev/proj/docs/a.md')).toBeNull();
      expect(diffDocFilePath('diff:///home/dev/proj/src/a.ts')).toBeNull();
    });
  });
});
