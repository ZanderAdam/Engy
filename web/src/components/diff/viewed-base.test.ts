import { describe, it, expect } from 'vitest';
import { viewedBaseFor } from './viewed-base';

describe('viewedBaseFor', () => {
  it('should scope a branch diff to its base branch name', () => {
    expect(viewedBaseFor('branch', 'origin/main', 'abc')).toBe('origin/main');
  });

  it('should scope history to the selected commit', () => {
    expect(viewedBaseFor('history', 'origin/main', 'abc')).toBe('abc');
  });

  it('should have no scope in history until a commit is selected', () => {
    expect(viewedBaseFor('history', 'origin/main', null)).toBeNull();
  });

  it('should use a fixed scope for the latest changes', () => {
    expect(viewedBaseFor('latest', 'origin/main', 'abc')).toBe('latest');
  });
});
