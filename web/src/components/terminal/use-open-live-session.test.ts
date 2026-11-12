import { describe, it, expect } from 'vitest';
import { isOnSessionPage, liveSessionPath } from './use-open-live-session';
import { projectGroupKey, shellGroupKey } from './group-key';
import { parseVirtualPath } from '@/components/tabs/tab-state';

const page = {
  workspaceSlug: 'ws',
  projectSlug: 'proj',
  worktree: undefined,
  combinedWorktrees: false,
};

describe('liveSessionPath', () => {
  it('[FR-TASK-340] should point at the project worktree that holds the session', () => {
    const path = liveSessionPath({
      sessionId: 's',
      groupKey: projectGroupKey('ws', 'proj', 'feat/x'),
      workspaceSlug: 'ws',
      projectSlug: 'proj',
    })!;

    expect(path).toBe('/w/ws/projects/proj?wt=feat%2Fx');
    expect(parseVirtualPath(path.split('?')[0])).toMatchObject({
      workspace: 'ws',
      project: 'proj',
    });
  });

  it('[FR-TASK-340] should point at the workspace for a session with no project', () => {
    expect(
      liveSessionPath({ sessionId: 's', groupKey: null, workspaceSlug: 'ws', projectSlug: null }),
    ).toBe('/w/ws');
  });
});

describe('isOnSessionPage', () => {
  it('[FR-TASK-340] should treat a shell terminal of the current project as on this page', () => {
    const target = {
      sessionId: 's',
      groupKey: shellGroupKey(projectGroupKey('ws', 'proj')),
      workspaceSlug: 'ws',
      projectSlug: 'proj',
    };

    expect(isOnSessionPage(target, page)).toBe(true);
  });

  it('[FR-TASK-340] should not treat another worktree as on this page unless worktrees are combined', () => {
    const target = {
      sessionId: 's',
      groupKey: projectGroupKey('ws', 'proj', 'feat'),
      workspaceSlug: 'ws',
      projectSlug: 'proj',
    };

    expect(isOnSessionPage(target, page)).toBe(false);
    expect(isOnSessionPage(target, { ...page, combinedWorktrees: true })).toBe(true);
  });

  it('[FR-TASK-340] should not treat another project as on this page', () => {
    const target = {
      sessionId: 's',
      groupKey: projectGroupKey('ws', 'other'),
      workspaceSlug: 'ws',
      projectSlug: 'other',
    };

    expect(isOnSessionPage(target, page)).toBe(false);
  });
});
