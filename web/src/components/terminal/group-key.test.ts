import { describe, it, expect } from 'vitest';
import { parseGroupKey, projectGroupKey, workspaceGroupKey } from './group-key';

describe('parseGroupKey', () => {
  it('[FR-TERMINAL-1030] should read a project key built by projectGroupKey', () => {
    expect(parseGroupKey(projectGroupKey('ws', 'alpha'))).toEqual({
      shell: false,
      workspaceSlug: 'ws',
      projectSlug: 'alpha',
    });
  });

  it('[FR-TERMINAL-1030] should read the worktree branch of a project key', () => {
    expect(parseGroupKey(projectGroupKey('ws', 'alpha', 'feat/x'))).toEqual({
      shell: false,
      workspaceSlug: 'ws',
      projectSlug: 'alpha',
      worktreeBranch: 'feat/x',
    });
  });

  it('[FR-TERMINAL-1030] should read a workspace key', () => {
    expect(parseGroupKey(workspaceGroupKey('ws'))).toEqual({ shell: false, workspaceSlug: 'ws' });
  });

  it('[FR-TERMINAL-1030] should read a worktree-scope key as workspace only', () => {
    expect(parseGroupKey('worktree:ws')).toEqual({ shell: false, workspaceSlug: 'ws' });
  });

  it('[FR-TERMINAL-1030] should flag a shell key and read the key under it', () => {
    expect(parseGroupKey(`shell:${projectGroupKey('ws', 'alpha', 'b')}`)).toEqual({
      shell: true,
      workspaceSlug: 'ws',
      projectSlug: 'alpha',
      worktreeBranch: 'b',
    });
  });

  it('[FR-TERMINAL-1030] should return undefined for keys that name no workspace', () => {
    expect(parseGroupKey('dir:/tmp/x')).toBeUndefined();
    expect(parseGroupKey('project:ws')).toBeUndefined();
  });
});
