import { describe, expect, it } from 'vitest';
import { revealGroupOf } from './file-groups-model';

describe('revealGroupOf', () => {
  const groups = [
    { id: 'lockfile', paths: ['pnpm-lock.yaml'] },
    { id: 'implementation', paths: ['src/app.ts'] },
  ];
  const collapsed = new Set(['lockfile', 'generated']);

  it('should expand the group holding the selected file', () => {
    const next = revealGroupOf(collapsed, 'unstaged:pnpm-lock.yaml', 'unstaged:', groups);
    expect([...next]).toEqual(['generated']);
  });

  it('should return the same set when the selected file is already visible', () => {
    expect(revealGroupOf(collapsed, 'unstaged:src/app.ts', 'unstaged:', groups)).toBe(collapsed);
  });

  it('should return the same set when nothing is selected or no group holds the file', () => {
    expect(revealGroupOf(collapsed, null, 'unstaged:', groups)).toBe(collapsed);
    expect(revealGroupOf(collapsed, 'unstaged:x.ts', 'unstaged:', groups)).toBe(collapsed);
  });
});
