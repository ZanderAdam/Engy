import { describe, it, expect } from 'vitest';
import {
  codeStateKey,
  defaultCodePageState,
  parseCodeState,
  serializeCodeState,
} from './code-page-state';

describe('code-page-state', () => {
  describe('codeStateKey', () => {
    it('should namespace by workspace and project', () => {
      expect(codeStateKey('ws', 'proj')).toBe('code-page:ws:proj');
    });

    it('should handle an absent project', () => {
      expect(codeStateKey('ws', undefined)).toBe('code-page:ws:');
    });
  });

  describe('parseCodeState', () => {
    it('should return defaults for null', () => {
      expect(parseCodeState(null)).toEqual(defaultCodePageState);
    });

    it('should return defaults for malformed JSON', () => {
      expect(parseCodeState('{not json')).toEqual(defaultCodePageState);
    });

    it('should round-trip a full state', () => {
      const state = {
        repo: '/repo',
        tabs: ['a.ts', 'b.ts'],
        active: 'b.ts',
        wordWrap: true,
        minimap: false,
      };
      expect(parseCodeState(serializeCodeState(state))).toEqual(state);
    });

    it('should migrate a legacy single-file state to tabs', () => {
      const legacy = JSON.stringify({ repo: '/repo', file: 'a.ts' });
      const parsed = parseCodeState(legacy);
      expect(parsed.tabs).toEqual(['a.ts']);
      expect(parsed.active).toBe('a.ts');
    });

    it('should drop an active path that is not among the open tabs', () => {
      const raw = JSON.stringify({ repo: '/r', tabs: ['a.ts'], active: 'gone.ts' });
      expect(parseCodeState(raw).active).toBe('a.ts');
    });

    it('should filter non-string tab entries', () => {
      const raw = JSON.stringify({ tabs: ['a.ts', 3, null, 'b.ts'] });
      expect(parseCodeState(raw).tabs).toEqual(['a.ts', 'b.ts']);
    });

    it('should dedupe repeated tab entries', () => {
      const raw = JSON.stringify({ tabs: ['a.ts', 'b.ts', 'a.ts'] });
      expect(parseCodeState(raw).tabs).toEqual(['a.ts', 'b.ts']);
    });

    it('should fall back to default view prefs when absent', () => {
      const parsed = parseCodeState(JSON.stringify({ repo: '/r' }));
      expect(parsed.wordWrap).toBe(false);
      expect(parsed.minimap).toBe(true);
    });
  });
});
