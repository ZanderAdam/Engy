import { describe, it, expect } from 'vitest';
import { diffUrlParams } from './diff-url-params';

const params = (query: string) => new URLSearchParams(query);

describe('diffs page URL params', () => {
  describe('diffUrlParams', () => {
    it('[FR-GIT-500] should read the repo, branch and view a link points at', () => {
      expect(diffUrlParams(params('diffView=branch&diffRepo=Engy&diffBranch=feature/login'))).toEqual(
        { repo: 'Engy', branch: 'feature/login', view: 'branch' },
      );
    });

    it('[FR-GIT-500] should report nothing when the link carries no params', () => {
      expect(diffUrlParams(params(''))).toEqual({ repo: null, branch: null, view: null });
    });

    it('[FR-GIT-500] should ignore a view mode the page does not have', () => {
      expect(diffUrlParams(params('diffView=sideways')).view).toBeNull();
    });

    it("[FR-GIT-500] should ignore another section's view and repo params", () => {
      expect(diffUrlParams(params('view=kanban&repo=other&branch=other'))).toEqual({
        repo: null,
        branch: null,
        view: null,
      });
    });
  });
});
