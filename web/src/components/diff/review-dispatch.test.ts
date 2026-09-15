import { describe, it, expect } from 'vitest';
import { buildReviewPrompt, describePatchSpec } from './review-dispatch';

const REPO = '/home/dev/proj';

describe('review dispatch', () => {
  describe('describePatchSpec', () => {
    it('should name the git invocation for staged changes', () => {
      expect(describePatchSpec({ kind: 'staged' })).toContain('--cached');
    });

    it('should name the git invocation for the working tree', () => {
      expect(describePatchSpec({ kind: 'unstaged' })).toContain('git diff');
    });

    it('should carry the hash for a single commit', () => {
      expect(describePatchSpec({ kind: 'commit', hash: 'abc123' })).toContain('abc123');
    });

    it('should carry both ends of an explicit range', () => {
      const described = describePatchSpec({ kind: 'range', from: 'main', to: 'HEAD' });
      expect(described).toContain('main');
      expect(described).toContain('HEAD');
    });

    it('should describe an open-ended range as against the working tree', () => {
      const described = describePatchSpec({ kind: 'range', from: 'main' });
      expect(described).toContain('main');
      expect(described).toContain('working tree');
    });
  });

  describe('buildReviewPrompt', () => {
    it('should invoke the review-diff skill', () => {
      expect(buildReviewPrompt({ repoDir: REPO, spec: { kind: 'unstaged' } })).toContain(
        '/engy:review-diff',
      );
    });

    it('should pass the repo so findings land on the diff being read', () => {
      const prompt = buildReviewPrompt({ repoDir: REPO, spec: { kind: 'unstaged' } });
      expect(prompt).toContain(`Run git in ${REPO}.`);
      expect(prompt).toContain('diff_review_');
    });

    it('should pass the scope so the agent reviews what is on screen', () => {
      const prompt = buildReviewPrompt({ repoDir: REPO, spec: { kind: 'commit', hash: 'deadbee' } });
      expect(prompt).toContain('deadbee');
    });

    it('[FR-GIT-450] should run git in the worktree on screen but file findings against the repo', () => {
      const worktreePath = '/home/dev/proj-wt';
      const prompt = buildReviewPrompt({
        repoDir: REPO,
        worktreePath,
        spec: { kind: 'unstaged' },
      });

      expect(prompt).toContain(`Run git in ${worktreePath}.`);
      expect(prompt).toContain(`against repoDir ${REPO}`);
    });
  });
});
