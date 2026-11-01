import { describe, it, expect, beforeEach } from 'vitest';
import { seed, apply, remove, getProjectCounts, subscribe } from './project-activity-store';

describe('project-activity-store', () => {
  beforeEach(() => {
    seed([]);
  });

  describe('seed', () => {
    it('[FR-TERMINAL-250] replaces the full session set so stale sessions are healed', () => {
      apply('s1', 'ws', 'proj-a', 'active');
      apply('s2', 'ws', 'proj-a', 'done');
      apply('s3', 'ws', 'proj-b', 'waiting');
      expect(getProjectCounts('ws', 'proj-a')).toEqual({ active: 1, waiting: 0, done: 1 });

      seed([{ sessionId: 's1', workspaceSlug: 'ws', projectSlug: 'proj-a', state: 'waiting' }]);

      expect(getProjectCounts('ws', 'proj-a')).toEqual({ active: 0, waiting: 1, done: 0 });
      expect(getProjectCounts('ws', 'proj-b')).toEqual({ active: 0, waiting: 0, done: 0 });
    });

    it('ignores sessions without a project slug', () => {
      seed([{ sessionId: 's1', workspaceSlug: 'ws', state: 'active' }]);
      expect(getProjectCounts('ws', 'proj-a')).toEqual({ active: 0, waiting: 0, done: 0 });
    });

    it('[FR-TERMINAL-1070] keeps same-slug projects in different workspaces apart', () => {
      seed([
        { sessionId: 's1', workspaceSlug: 'ws-a', projectSlug: 'default', state: 'done' },
        { sessionId: 's2', workspaceSlug: 'ws-b', projectSlug: 'default', state: 'active' },
      ]);

      expect(getProjectCounts('ws-a', 'default')).toEqual({ active: 0, waiting: 0, done: 1 });
      expect(getProjectCounts('ws-b', 'default')).toEqual({ active: 1, waiting: 0, done: 0 });
    });
  });

  describe('apply and remove', () => {
    it('rolls up per-project counts and drops idle sessions', () => {
      apply('s1', 'ws', 'proj-a', 'active');
      apply('s2', 'ws', 'proj-a', 'active');
      expect(getProjectCounts('ws', 'proj-a')).toEqual({ active: 2, waiting: 0, done: 0 });

      apply('s1', 'ws', 'proj-a', 'idle');
      expect(getProjectCounts('ws', 'proj-a')).toEqual({ active: 1, waiting: 0, done: 0 });

      remove('s2');
      expect(getProjectCounts('ws', 'proj-a')).toEqual({ active: 0, waiting: 0, done: 0 });
    });

    it('[FR-TERMINAL-1070] rolls live deltas up per workspace', () => {
      apply('s1', 'ws-a', 'default', 'done');
      apply('s2', 'ws-b', 'default', 'done');

      expect(getProjectCounts('ws-a', 'default')).toEqual({ active: 0, waiting: 0, done: 1 });
    });

    it('notifies subscribers on change and stops after unsubscribe', () => {
      let calls = 0;
      const unsubscribe = subscribe(() => {
        calls++;
      });

      apply('s1', 'ws', 'proj-a', 'active');
      expect(calls).toBe(1);

      unsubscribe();
      apply('s1', 'ws', 'proj-a', 'waiting');
      expect(calls).toBe(1);
    });
  });
});
