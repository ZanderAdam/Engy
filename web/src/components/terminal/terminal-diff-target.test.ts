import { describe, it, expect } from 'vitest';
import { branchDiffHref, resolveDiffTarget } from './terminal-diff-target';

const REPO = '/home/dev/proj';
const OTHER_REPO = '/home/dev/proj-tools';
const GROUPS = [
  {
    branch: 'feature/login',
    repos: [{ repoPath: REPO, worktreePath: '/home/dev/proj/.worktrees/login' }],
  },
];

describe('terminal diff target', () => {
  describe('resolveDiffTarget', () => {
    it('[FR-GIT-490] should map a worktree working directory back to its repo and branch', () => {
      expect(resolveDiffTarget('/home/dev/proj/.worktrees/login', GROUPS, [REPO])).toEqual({
        repoDir: REPO,
        worktreeBranch: 'feature/login',
      });
    });

    it('[FR-GIT-490] should resolve a plain checkout to the repo itself', () => {
      expect(resolveDiffTarget(REPO, GROUPS, [REPO])).toEqual({
        repoDir: REPO,
        worktreeBranch: null,
      });
    });

    it('[FR-GIT-490] should resolve a subdirectory to the repo that contains it', () => {
      expect(resolveDiffTarget(`${REPO}/web/src`, GROUPS, [REPO])).toEqual({
        repoDir: REPO,
        worktreeBranch: null,
      });
    });

    it('[FR-GIT-490] should pick the innermost repo when one repo sits inside another', () => {
      const nested = `${REPO}/vendor/lib`;
      expect(resolveDiffTarget(`${nested}/src`, [], [REPO, nested])?.repoDir).toBe(nested);
    });

    it('[FR-GIT-490] should not treat a sibling with a shared prefix as the repo', () => {
      expect(resolveDiffTarget(OTHER_REPO, [], [REPO])).toBeNull();
    });

    it('[FR-GIT-490] should return null when no repo contains the working directory', () => {
      expect(resolveDiffTarget('/tmp/scratch', GROUPS, [REPO])).toBeNull();
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

    it('[FR-GIT-490] should select the worktree by branch when the terminal runs in one', () => {
      const href = branchDiffHref({
        workspaceSlug: 'engy',
        projectSlug: 'initial',
        target: { repoDir: REPO, worktreeBranch: 'feature/login' },
      });
      expect(href).toContain('wt=feature%2Flogin');
    });
  });
});
