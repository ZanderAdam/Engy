import { describe, expect, it } from 'vitest';
import {
  flattenLoadedDirs,
  joinRel,
  parentRelDir,
  pruneLoadedDirs,
  toRelPath,
  type LoadedDir,
} from './repo-file-tree-helpers';

describe('repo file tree helpers', () => {
  describe('joinRel', () => {
    it('should join a dir and name with a slash', () => {
      expect(joinRel('src/server', 'file.ts')).toBe('src/server/file.ts');
    });

    it('should return the name alone for the root dir', () => {
      expect(joinRel('', 'file.ts')).toBe('file.ts');
    });
  });

  describe('parentRelDir', () => {
    it('should return the parent of a nested path', () => {
      expect(parentRelDir('src/server/file.ts')).toBe('src/server');
    });

    it('should return root for a top-level path', () => {
      expect(parentRelDir('file.ts')).toBe('');
    });
  });

  describe('toRelPath', () => {
    it('should strip the root prefix from an absolute path', () => {
      expect(toRelPath('/repo/src/a.ts', '/repo')).toBe('src/a.ts');
    });

    it('should handle a root dir with a trailing slash', () => {
      expect(toRelPath('/repo/src/a.ts', '/repo/')).toBe('src/a.ts');
    });

    it('should return the path unchanged when it is not under the root', () => {
      expect(toRelPath('other/a.ts', '/repo')).toBe('other/a.ts');
    });
  });

  describe('flattenLoadedDirs', () => {
    it('should flatten loaded dirs into relative file entries and dir paths', () => {
      const loaded = new Map<string, LoadedDir>([
        ['', { dirs: ['src'], files: [{ name: 'README.md', mtime: 1 }] }],
        ['src', { dirs: ['lib'], files: [{ name: 'index.ts', mtime: 2 }] }],
      ]);

      const { files, dirs } = flattenLoadedDirs(loaded);

      expect(files).toEqual([
        { path: 'README.md', mtime: 1 },
        { path: 'src/index.ts', mtime: 2 },
      ]);
      expect(dirs).toEqual(['src', 'src/lib']);
    });

    it('should return empty lists for an empty map', () => {
      expect(flattenLoadedDirs(new Map())).toEqual({ files: [], dirs: [] });
    });
  });

  describe('pruneLoadedDirs', () => {
    it('should remove the pruned dir and its descendants but keep siblings', () => {
      const entry: LoadedDir = { dirs: [], files: [] };
      const loaded = new Map<string, LoadedDir>([
        ['', entry],
        ['src', entry],
        ['src/lib', entry],
        ['srcother', entry],
      ]);

      const next = pruneLoadedDirs(loaded, 'src');

      expect([...next.keys()]).toEqual(['', 'srcother']);
    });

    it('should leave the map unchanged when the path is not loaded', () => {
      const loaded = new Map<string, LoadedDir>([['', { dirs: [], files: [] }]]);
      expect([...pruneLoadedDirs(loaded, 'missing').keys()]).toEqual(['']);
    });
  });
});
