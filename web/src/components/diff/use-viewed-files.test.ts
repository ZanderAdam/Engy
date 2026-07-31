import { describe, it, expect } from 'vitest';
import {
  applyViewed,
  readStore,
  resolveViewedPaths,
  scopeKey,
  writeScope,
} from './use-viewed-files';

const SCOPE = {
  workspaceSlug: 'ws',
  projectSlug: 'proj',
  dir: '/repo',
  base: 'origin/main',
};

describe('viewed file tracking', () => {
  describe('scopeKey', () => {
    it('combines workspace, project, checkout and base into one key', () => {
      expect(scopeKey(SCOPE)).toBe('ws::proj::/repo::origin/main');
    });

    it('is null when any part is missing', () => {
      expect(scopeKey({ ...SCOPE, workspaceSlug: null })).toBeNull();
      expect(scopeKey({ ...SCOPE, projectSlug: null })).toBeNull();
      expect(scopeKey({ ...SCOPE, dir: null })).toBeNull();
      expect(scopeKey({ ...SCOPE, base: null })).toBeNull();
    });

    it('separates two projects in the same workspace', () => {
      expect(scopeKey(SCOPE)).not.toBe(scopeKey({ ...SCOPE, projectSlug: 'other' }));
    });

    it('separates two worktrees of the same repo', () => {
      expect(scopeKey(SCOPE)).not.toBe(scopeKey({ ...SCOPE, dir: '/repo/.worktrees/wt' }));
    });

    it('separates two bases in the same checkout', () => {
      expect(scopeKey(SCOPE)).not.toBe(scopeKey({ ...SCOPE, base: 'origin/develop' }));
    });
  });

  describe('readStore', () => {
    it('returns an empty store for missing or malformed input', () => {
      expect(readStore(null)).toEqual({});
      expect(readStore('not json')).toEqual({});
      expect(readStore('[1,2,3]')).toEqual({});
      expect(readStore('"a string"')).toEqual({});
    });

    it('parses a well-formed store', () => {
      expect(readStore('{"ws::proj::/repo::main":{"a.ts":"sha1"}}')).toEqual({
        'ws::proj::/repo::main': { 'a.ts': 'sha1' },
      });
    });

    it('drops the v1 array payload rather than importing marks with no content id', () => {
      expect(readStore('{"old-scope":["a.ts","b.ts"]}')).toEqual({});
    });

    it('drops non-string content ids', () => {
      expect(readStore('{"scope":{"a.ts":"sha","b.ts":5,"c.ts":null}}')).toEqual({
        scope: { 'a.ts': 'sha' },
      });
    });
  });

  describe('resolveViewedPaths', () => {
    it('keeps a mark while the content id still matches', () => {
      const viewed = resolveViewedPaths({ 'a.ts': 'sha1' }, new Map([['a.ts', 'sha1']]));

      expect([...viewed]).toEqual(['a.ts']);
    });

    it('expires a mark once the file changes', () => {
      const viewed = resolveViewedPaths({ 'a.ts': 'sha1' }, new Map([['a.ts', 'sha2']]));

      expect([...viewed]).toEqual([]);
    });

    it('expires a mark when the file no longer has a content id', () => {
      const viewed = resolveViewedPaths({ 'a.ts': 'sha1' }, new Map([['a.ts', undefined]]));

      expect([...viewed]).toEqual([]);
    });

    it('keeps a mark recorded with no content id while the file still has none', () => {
      const viewed = resolveViewedPaths({ 'gone.ts': '' }, new Map([['gone.ts', undefined]]));

      expect([...viewed]).toEqual(['gone.ts']);
    });

    it('ignores marks for paths absent from the current diff', () => {
      const viewed = resolveViewedPaths({ 'a.ts': 'sha1' }, new Map());

      expect([...viewed]).toEqual([]);
    });
  });

  describe('applyViewed', () => {
    const ids = new Map<string, string | undefined>([
      ['a.ts', 'sha-a'],
      ['b.ts', 'sha-b'],
      ['gone.ts', undefined],
    ]);

    it('marks several paths in one pass, stamping each with its content id', () => {
      expect(applyViewed({}, ['a.ts', 'b.ts'], true, ids)).toEqual({
        'a.ts': 'sha-a',
        'b.ts': 'sha-b',
      });
    });

    it('clears several paths in one pass', () => {
      const scope = { 'a.ts': 'sha-a', 'b.ts': 'sha-b', 'c.ts': 'sha-c' };

      expect(applyViewed(scope, ['a.ts', 'b.ts'], false, ids)).toEqual({ 'c.ts': 'sha-c' });
    });

    it('records an empty id for a path with no content id', () => {
      expect(applyViewed({}, ['gone.ts'], true, ids)).toEqual({ 'gone.ts': '' });
    });

    it('leaves untouched paths alone', () => {
      const scope = { 'other.ts': 'sha-other' };

      expect(applyViewed(scope, ['a.ts'], true, ids)).toEqual({
        'other.ts': 'sha-other',
        'a.ts': 'sha-a',
      });
    });

    it('re-stamps an already-marked path with its current id', () => {
      expect(applyViewed({ 'a.ts': 'stale' }, ['a.ts'], true, ids)).toEqual({ 'a.ts': 'sha-a' });
    });

    it('is a no-op for an empty path list', () => {
      const scope = { 'a.ts': 'sha-a' };

      expect(applyViewed(scope, [], true, ids)).toEqual(scope);
    });

    it('does not mutate the input scope', () => {
      const scope = { 'a.ts': 'sha-a' };

      applyViewed(scope, ['a.ts'], false, ids);

      expect(scope).toEqual({ 'a.ts': 'sha-a' });
    });

    it('round-trips with resolveViewedPaths so a bulk mark reads back as viewed', () => {
      const scope = applyViewed({}, ['a.ts', 'b.ts'], true, ids);

      expect([...resolveViewedPaths(scope, ids)].sort()).toEqual(['a.ts', 'b.ts']);
    });
  });

  describe('writeScope', () => {
    it('adds a new scope while keeping existing ones', () => {
      const store = writeScope({ existing: { 'a.ts': 'sha' } }, 'fresh', { 'b.ts': 'sha2' });

      expect(store).toEqual({ existing: { 'a.ts': 'sha' }, fresh: { 'b.ts': 'sha2' } });
    });

    it('replaces the contents of an existing scope', () => {
      const store = writeScope({ scope: { 'a.ts': 'sha' } }, 'scope', { 'b.ts': 'sha2' });

      expect(store).toEqual({ scope: { 'b.ts': 'sha2' } });
    });

    it('evicts the least recently written scope past the cap', () => {
      let store = {};
      for (let i = 0; i < 21; i++) store = writeScope(store, `scope-${i}`, { 'f.ts': `sha-${i}` });

      expect(Object.keys(store)).toHaveLength(20);
      expect((store as Record<string, unknown>)['scope-0']).toBeUndefined();
      expect((store as Record<string, unknown>)['scope-20']).toEqual({ 'f.ts': 'sha-20' });
    });

    it('refreshes recency so a re-written scope survives eviction', () => {
      let store = {};
      for (let i = 0; i < 20; i++) store = writeScope(store, `scope-${i}`, { 'f.ts': `sha-${i}` });
      store = writeScope(store, 'scope-0', { 'f.ts': 'touched' });
      store = writeScope(store, 'scope-20', { 'f.ts': 'sha-20' });

      expect((store as Record<string, unknown>)['scope-0']).toEqual({ 'f.ts': 'touched' });
      expect((store as Record<string, unknown>)['scope-1']).toBeUndefined();
    });

    it('does not mutate the input store', () => {
      const original = { scope: { 'a.ts': 'sha' } };

      writeScope(original, 'scope', { 'b.ts': 'sha2' });

      expect(original).toEqual({ scope: { 'a.ts': 'sha' } });
    });
  });
});
