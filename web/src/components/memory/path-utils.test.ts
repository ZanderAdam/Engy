import { describe, it, expect } from 'vitest';
import { toRelativeMemoryPath } from './path-utils';

describe('toRelativeMemoryPath', () => {
  it('should return already-relative forward-slash paths unchanged', () => {
    expect(toRelativeMemoryPath('memory/decisions/foo.md')).toBe('memory/decisions/foo.md');
  });

  it('should strip absolute Unix prefix', () => {
    expect(toRelativeMemoryPath('/home/user/.engy/my-ws/memory/facts/bar.md')).toBe(
      'memory/facts/bar.md',
    );
  });

  it('should normalise backslashes from Windows paths', () => {
    expect(toRelativeMemoryPath('memory\\patterns\\baz.md')).toBe('memory/patterns/baz.md');
  });

  it('should strip absolute Windows prefix with backslashes', () => {
    expect(
      toRelativeMemoryPath('C:\\Users\\user\\.engy\\ws\\memory\\conventions\\qux.md'),
    ).toBe('memory/conventions/qux.md');
  });

  it('should handle paths with memory/ already at position 0', () => {
    expect(toRelativeMemoryPath('memory/insights/insight.md')).toBe('memory/insights/insight.md');
  });
});
