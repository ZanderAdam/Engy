import { describe, it, expect } from 'vitest';
import { buildNavigationPath } from './global-search';
import { parseTaskId } from './task-id';

describe('parseTaskId', () => {
  it('should return the numeric id for a valid positive integer string', () => {
    expect(parseTaskId('42')).toBe(42);
  });

  it('should return the numeric id for a large id', () => {
    expect(parseTaskId('9999')).toBe(9999);
  });

  it('should return null for a non-numeric string', () => {
    expect(parseTaskId('abc')).toBeNull();
  });

  it('should return null for an empty string', () => {
    expect(parseTaskId('')).toBeNull();
  });

  it('should return null for null', () => {
    expect(parseTaskId(null)).toBeNull();
  });

  it('should return null for zero', () => {
    expect(parseTaskId('0')).toBeNull();
  });

  it('should return null for a negative number', () => {
    expect(parseTaskId('-1')).toBeNull();
  });
});

describe('buildNavigationPath', () => {
  describe('task paths', () => {
    it('should navigate to /tasks?task=<id> for a valid task path', () => {
      expect(buildNavigationPath('my-workspace', 'task:42')).toBe(
        '/w/my-workspace/tasks?task=42',
      );
    });

    it('should navigate to /tasks?task=<id> for a large task id', () => {
      expect(buildNavigationPath('ws', 'task:9999')).toBe('/w/ws/tasks?task=9999');
    });

    it('should fall back to bare /tasks when task id is non-numeric', () => {
      expect(buildNavigationPath('ws', 'task:abc')).toBe('/w/ws/tasks');
    });

    it('should fall back to bare /tasks when task id is empty', () => {
      expect(buildNavigationPath('ws', 'task:')).toBe('/w/ws/tasks');
    });

    it('should fall back to bare /tasks when task id is zero', () => {
      expect(buildNavigationPath('ws', 'task:0')).toBe('/w/ws/tasks');
    });

    it('should fall back to bare /tasks when task id is negative', () => {
      expect(buildNavigationPath('ws', 'task:-1')).toBe('/w/ws/tasks');
    });
  });

  describe('memory paths', () => {
    it('should navigate to /memory?path=<encoded> for a memory path', () => {
      expect(buildNavigationPath('ws', 'memory/decisions/foo.md')).toBe(
        '/w/ws/memory?path=memory%2Fdecisions%2Ffoo.md',
      );
    });

    it('should encode special characters in memory paths', () => {
      expect(buildNavigationPath('ws', 'memory/decisions/foo bar.md')).toBe(
        '/w/ws/memory?path=memory%2Fdecisions%2Ffoo%20bar.md',
      );
    });
  });

  describe('doc and system paths', () => {
    it('should navigate to /docs?file=<encoded> for a docs path', () => {
      expect(buildNavigationPath('ws', 'docs/guide.md')).toBe(
        '/w/ws/docs?file=guide.md',
      );
    });

    it('should navigate to /docs?file=<encoded> for a system path', () => {
      expect(buildNavigationPath('ws', 'system/readme.md')).toBe(
        '/w/ws/docs?file=readme.md',
      );
    });

    it('should navigate to /docs?file=<encoded> for a projects path', () => {
      expect(buildNavigationPath('ws', 'projects/default/plans/my-task.plan.md')).toBe(
        '/w/ws/docs?file=default%2Fplans%2Fmy-task.plan.md',
      );
    });

    it('should encode special characters in doc paths', () => {
      expect(buildNavigationPath('ws', 'docs/my file.md')).toBe(
        '/w/ws/docs?file=my%20file.md',
      );
    });
  });
});
