import { describe, it, expect } from 'vitest';
import { branchDiffHref, resolveDiffTarget } from './terminal-diff-target';

const REPO = '/home/dev/proj';
const OTHER_REPO = '/home/dev/other';

describe('terminal diff link', () => {
  describe('resolveDiffTarget', () => {
    it('[FR-GIT-490] should take the repo and branch git reports for a worktree outside it', () => {
      expect(
        resolveDiffTarget({
          gitRepoRoot: REPO,
          gitBranch: 'feature/login',
          workingDir: '/home/dev/worktrees/feature-login',
          repos: [REPO, OTHER_REPO],
        }),
      ).toEqual({ repo: 'proj', branch: 'feature/login' });
    });

    it('[FR-GIT-490] should leave the branch to the page when git speaks for another repo', () => {
      expect(
        resolveDiffTarget({
          gitRepoRoot: `${REPO}/docs`,
          gitBranch: 'master',
          workingDir: `${REPO}/docs/projects/x`,
          repos: [REPO],
        }),
      ).toEqual({ repo: 'proj', branch: null });
    });

    it('[FR-GIT-490] should fall back to the innermost workspace repo containing the directory', () => {
      const nested = `${REPO}/packages/api`;
      expect(
        resolveDiffTarget({
          gitRepoRoot: null,
          gitBranch: null,
          workingDir: `${nested}/src`,
          repos: [REPO, nested],
        })?.repo,
      ).toBe('api');
    });

    it('[FR-GIT-490] should use the lone repo for a directory outside every repo', () => {
      expect(
        resolveDiffTarget({
          gitRepoRoot: null,
          gitBranch: null,
          workingDir: '/home/dev/.engy/ws/projects/x',
          repos: [REPO],
        }),
      ).toEqual({ repo: 'proj', branch: null });
    });

    it('[FR-GIT-490] should write the path when two repos share a directory name', () => {
      const twin = '/home/dev/fork/proj';
      expect(
        resolveDiffTarget({
          gitRepoRoot: REPO,
          gitBranch: 'feature/login',
          workingDir: '/home/dev/worktrees/feature-login',
          repos: [REPO, twin],
        }),
      ).toEqual({ repo: REPO, branch: 'feature/login' });
    });

    it('[FR-GIT-490] should refuse to guess between several repos', () => {
      expect(
        resolveDiffTarget({
          gitRepoRoot: null,
          gitBranch: null,
          workingDir: '/home/dev/.engy/ws/projects/x',
          repos: [REPO, OTHER_REPO],
        }),
      ).toBeNull();
    });
  });

  describe('branchDiffHref', () => {
    it('[FR-GIT-490] should name the repo and branch the way the dropdowns do', () => {
      expect(
        branchDiffHref({
          workspaceSlug: 'engy',
          projectSlug: 'initial',
          target: { repo: 'proj', branch: 'feature/login' },
        }),
      ).toBe(
        '/w/engy/projects/initial/diffs?diffView=branch&diffRepo=proj&diffBranch=feature%2Flogin',
      );
    });

    it('[FR-GIT-490] should carry the tab’s worktree param through untouched', () => {
      expect(
        branchDiffHref({
          workspaceSlug: 'engy',
          projectSlug: 'initial',
          target: { repo: 'proj', branch: 'feature/login' },
          worktreeParam: 'feature/login',
        }),
      ).toBe(
        '/w/engy/projects/initial/diffs?diffView=branch&diffRepo=proj&diffBranch=feature%2Flogin&wt=feature%2Flogin',
      );
    });

    it('[FR-GIT-490] should omit the branch when none was resolved', () => {
      expect(
        branchDiffHref({
          workspaceSlug: 'engy',
          projectSlug: 'initial',
          target: { repo: 'proj', branch: null },
        }),
      ).toBe('/w/engy/projects/initial/diffs?diffView=branch&diffRepo=proj');
    });
  });
});
