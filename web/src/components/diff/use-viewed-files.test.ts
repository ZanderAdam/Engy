import { describe, it, expect } from 'vitest';
import { readStore, scopeKey, writeScope } from './use-viewed-files';

describe('viewed file tracking', () => {
  describe('scopeKey', () => {
    it('combines repo and base into one key', () => {
      expect(scopeKey('/repo', 'origin/main')).toBe('/repo::origin/main');
    });

    it('is null when either half is missing', () => {
      expect(scopeKey(null, 'origin/main')).toBeNull();
      expect(scopeKey('/repo', null)).toBeNull();
    });

    it('separates two branches in the same repo', () => {
      expect(scopeKey('/repo', 'origin/main')).not.toBe(scopeKey('/repo', 'origin/develop'));
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
      expect(readStore('{"/repo::main":["a.ts","b.ts"]}')).toEqual({
        '/repo::main': ['a.ts', 'b.ts'],
      });
    });

    it('drops non-array scopes and non-string paths', () => {
      expect(readStore('{"good":["a.ts",5,null],"bad":"nope"}')).toEqual({ good: ['a.ts'] });
    });
  });

  describe('writeScope', () => {
    it('adds a new scope while keeping existing ones', () => {
      const store = writeScope({ existing: ['a.ts'] }, 'fresh', ['b.ts']);

      expect(store).toEqual({ existing: ['a.ts'], fresh: ['b.ts'] });
    });

    it('replaces the paths of an existing scope', () => {
      const store = writeScope({ scope: ['a.ts'] }, 'scope', ['b.ts']);

      expect(store).toEqual({ scope: ['b.ts'] });
    });

    it('evicts the least recently written scope past the cap', () => {
      let store: Record<string, string[]> = {};
      for (let i = 0; i < 21; i++) store = writeScope(store, `scope-${i}`, [`file-${i}.ts`]);

      expect(Object.keys(store)).toHaveLength(20);
      expect(store['scope-0']).toBeUndefined();
      expect(store['scope-20']).toEqual(['file-20.ts']);
    });

    it('refreshes recency so a re-written scope survives eviction', () => {
      let store: Record<string, string[]> = {};
      for (let i = 0; i < 20; i++) store = writeScope(store, `scope-${i}`, [`file-${i}.ts`]);
      store = writeScope(store, 'scope-0', ['touched.ts']);
      store = writeScope(store, 'scope-20', ['file-20.ts']);

      expect(store['scope-0']).toEqual(['touched.ts']);
      expect(store['scope-1']).toBeUndefined();
    });

    it('does not mutate the input store', () => {
      const original = { scope: ['a.ts'] };

      writeScope(original, 'scope', ['b.ts']);

      expect(original).toEqual({ scope: ['a.ts'] });
    });
  });
});
