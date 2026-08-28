import { describe, it, expect } from 'vitest';
import { buildModelPath, needsContentSync } from './monaco-models';

describe('buildModelPath', () => {
  it('should join repo root and relative path into a single absolute path', () => {
    expect(buildModelPath('/Users/me/repo', 'src/app.ts')).toBe('/Users/me/repo/src/app.ts');
  });

  it('should normalise leading and trailing slashes on the root', () => {
    expect(buildModelPath('/Users/me/repo/', 'src/app.ts')).toBe('/Users/me/repo/src/app.ts');
  });

  it('should normalise a leading slash on the relative path', () => {
    expect(buildModelPath('/repo', '/src/app.ts')).toBe('/repo/src/app.ts');
  });

  it('should keep models for the same file under different roots distinct', () => {
    const a = buildModelPath('/repo-a', 'src/app.ts');
    const b = buildModelPath('/repo-b', 'src/app.ts');
    expect(a).not.toBe(b);
  });
});

describe('needsContentSync', () => {
  it('[FR-GIT-350] should rewrite a model still holding an earlier revision', () => {
    expect(needsContentSync('old content', 'new content')).toBe(true);
  });

  it('[FR-GIT-350] should leave a model that already holds the content', () => {
    expect(needsContentSync('same', 'same')).toBe(false);
  });

  it('[FR-GIT-350] should refill a model left empty while its read was in flight', () => {
    expect(needsContentSync('', 'fetched content')).toBe(true);
  });

  it('should never overwrite the side the user is typing into', () => {
    expect(needsContentSync('what the user typed', 'what was fetched', true)).toBe(false);
  });
});
