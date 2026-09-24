import { describe, it, expect } from 'vitest';
import { branchDiffHref, resolveDiffTarget } from './terminal-diff-target';

const REPO = '/home/dev/proj';
const OTHER_REPO = '/home/dev/proj-tools';
// What a project terminal actually runs in: the project's docs directory. It is
// the same path whichever worktree the session targets.
const PROJECT_DIR = `${REPO}/docs/projects/initial`;
const GROUPS = [
  {
    branch: 'feature/login',
    repos: [{ repoPath: REPO, worktreePath: '/home/dev/.engy/ws/worktrees/initial/login/proj' }],
  },
];

describe('terminal diff target', () => {
  describe('resolveDiffTarget', () => {
    it('[FR-GIT-490] should send a worktree session to its branch, not to the main checkout', () => {
      expect(
        resolveDiffTarget(
          { workingDir: PROJECT_DIR, worktreeBranch: 'feature/login' },
          GROUPS,
          [REPO],
        ),
      ).toEqual({ repoDir: REPO, worktreeBranch: 'feature/login' });
    });

    it('[FR-GIT-490] should name the branch even before its worktree is materialized', () => {
      expect(
        resolveDiffTarget({ workingDir: PROJECT_DIR, worktreeBranch: 'feature/new' }, [], [REPO]),
      ).toEqual({ repoDir: REPO, worktreeBranch: 'feature/new' });
    });

    it('[FR-GIT-490] should leave a session with no worktree on the main checkout', () => {
      expect(resolveDiffTarget({ workingDir: PROJECT_DIR }, GROUPS, [REPO])).toEqual({
        repoDir: REPO,
        worktreeBranch: null,
      });
    });

    it('[FR-GIT-490] should resolve a session running in the repo itself', () => {
      expect(resolveDiffTarget({ workingDir: REPO }, [], [REPO])).toEqual({
        repoDir: REPO,
        worktreeBranch: null,
      });
    });

    it('[FR-GIT-490] should pick the innermost repo when one repo sits inside another', () => {
      const nested = `${REPO}/vendor/lib`;
      expect(resolveDiffTarget({ workingDir: `${nested}/src` }, [], [REPO, nested])?.repoDir).toBe(
        nested,
      );
    });

    it('[FR-GIT-490] should not treat a sibling with a shared prefix as the repo', () => {
      expect(resolveDiffTarget({ workingDir: OTHER_REPO }, [], [REPO, 'x'])).toBeNull();
    });

    // A project's docs directory often sits outside every repo, and then only
    // the single-repo workspace has an unambiguous answer.
    it('[FR-GIT-490] should fall back to the lone repo of a single-repo workspace', () => {
      expect(resolveDiffTarget({ workingDir: '/home/dev/.engy/ws/projects/x' }, [], [REPO])).toEqual(
        { repoDir: REPO, worktreeBranch: null },
      );
    });

    it('[FR-GIT-490] should refuse to guess between several repos', () => {
      expect(
        resolveDiffTarget({ workingDir: '/home/dev/.engy/ws/projects/x' }, [], [REPO, OTHER_REPO]),
      ).toBeNull();
    });

    it('[FR-GIT-490] should pick the repo that owns the worktree in a multi-repo workspace', () => {
      const groups = [
        {
          branch: 'feature/login',
          repos: [{ repoPath: OTHER_REPO, worktreePath: '/wt/tools' }],
        },
      ];
      expect(
        resolveDiffTarget(
          { workingDir: '/home/dev/.engy/ws/projects/x', worktreeBranch: 'feature/login' },
          groups,
          [REPO, OTHER_REPO],
        ),
      ).toEqual({ repoDir: OTHER_REPO, worktreeBranch: 'feature/login' });
    });
  });

  describe('branchDiffHref', () => {
    it('[FR-GIT-490] should open the diffs page in branch review for the repo', () => {
      const href = branchDiffHref({
        workspaceSlug: 'engy',
        projectSlug: 'initial',
        target: { repoDir: REPO, worktreeBranch: null },
      });
      expect(href).toBe(
        '/w/engy/projects/initial/diffs?diffView=branch&diffRepo=%2Fhome%2Fdev%2Fproj',
      );
    });

    it('[FR-GIT-490] should select the worktree by branch when the session targets one', () => {
      const href = branchDiffHref({
        workspaceSlug: 'engy',
        projectSlug: 'initial',
        target: { repoDir: REPO, worktreeBranch: 'feature/login' },
      });
      expect(href).toContain('wt=feature%2Flogin');
    });
  });
});
