import { describe, it, expect, beforeEach } from 'vitest';
import { seed, apply, remove, getProjectCounts, subscribe } from './project-activity-store';

describe('project-activity-store', () => {
  beforeEach(() => {
    seed([]);
  });

  describe('seed', () => {
    it('[FR-TERMINAL-250] replaces the full session set so stale sessions are healed', () => {
      apply('s1', 'proj-a', 'active');
      apply('s2', 'proj-a', 'done');
      apply('s3', 'proj-b', 'waiting');
      expect(getProjectCounts('proj-a')).toEqual({ active: 1, waiting: 0, done: 1 });

      // Snapshot no longer contains s2 (exited while disconnected) and reports
      // s1 as waiting — seeding must reflect exactly the snapshot, not merge.
      seed([{ sessionId: 's1', projectSlug: 'proj-a', state: 'waiting' }]);

      expect(getProjectCounts('proj-a')).toEqual({ active: 0, waiting: 1, done: 0 });
      expect(getProjectCounts('proj-b')).toEqual({ active: 0, waiting: 0, done: 0 });
    });

    it('ignores sessions without a project slug', () => {
      seed([{ sessionId: 's1', state: 'active' }]);
      expect(getProjectCounts('proj-a')).toEqual({ active: 0, waiting: 0, done: 0 });
    });
  });

  describe('apply and remove', () => {
    it('rolls up per-project counts and drops idle sessions', () => {
      apply('s1', 'proj-a', 'active');
      apply('s2', 'proj-a', 'active');
      expect(getProjectCounts('proj-a')).toEqual({ active: 2, waiting: 0, done: 0 });

      apply('s1', 'proj-a', 'idle');
      expect(getProjectCounts('proj-a')).toEqual({ active: 1, waiting: 0, done: 0 });

      remove('s2');
      expect(getProjectCounts('proj-a')).toEqual({ active: 0, waiting: 0, done: 0 });
    });

    it('notifies subscribers on change and stops after unsubscribe', () => {
      let calls = 0;
      const unsubscribe = subscribe(() => {
        calls++;
      });

      apply('s1', 'proj-a', 'active');
      expect(calls).toBe(1);

      unsubscribe();
      apply('s1', 'proj-a', 'waiting');
      expect(calls).toBe(1);
    });
  });
});
