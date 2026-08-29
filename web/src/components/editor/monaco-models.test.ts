import { describe, it, expect } from 'vitest';
import { buildModelPath } from './monaco-models';

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
