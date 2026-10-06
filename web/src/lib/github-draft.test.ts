import { describe, it, expect } from 'vitest';
import { isDraftOfPr } from './github-draft';

describe('[FR-PRMON-250] isDraftOfPr', () => {
  const draft = { githubDraft: true, source: 'local', prNumber: 7 };

  it('should match a draft of the same PR', () => {
    expect(isDraftOfPr(draft, 7)).toBe(true);
  });

  it('should not match a draft of another PR that shares the branch name', () => {
    expect(isDraftOfPr(draft, 8)).toBe(false);
  });

  it('should not match a note that is not a GitHub draft', () => {
    expect(isDraftOfPr({ source: 'local', prNumber: 7 }, 7)).toBe(false);
  });
});
