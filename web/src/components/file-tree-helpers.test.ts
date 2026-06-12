import { describe, it, expect, vi } from 'vitest';
import {
  applyDefaultExtension,
  buildFileTree,
  buildTrie,
  parentPrefix,
  trieToTreeItems,
} from './file-tree-helpers';

describe('file-tree-helpers', () => {
  describe('buildTrie', () => {
    describe('flat files', () => {
      it('should place root-level files in the root node', () => {
        const trie = buildTrie([{ path: 'a.md', mtime: 1 }], []);
        expect(trie.files).toHaveLength(1);
        expect(trie.files[0].name).toBe('a.md');
        expect(trie.children.size).toBe(0);
      });
    });

    describe('nested dirs', () => {
      it('should build nested directory nodes for deep paths', () => {
        const trie = buildTrie([{ path: 'a/b/c.md', mtime: 5 }], []);
        const aNode = trie.children.get('a');
        expect(aNode).toBeDefined();
        const bNode = aNode?.children.get('b');
        expect(bNode).toBeDefined();
        expect(bNode?.files[0].name).toBe('c.md');
      });

      it('should propagate maxMtime up intermediate dir nodes', () => {
        const trie = buildTrie([{ path: 'a/b/c.md', mtime: 42 }], []);
        expect(trie.maxMtime).toBe(42);
        expect(trie.children.get('a')?.maxMtime).toBe(42);
      });
    });

    describe('empty dirs', () => {
      it('should create dir nodes for explicit empty directories', () => {
        const trie = buildTrie([], ['empty-dir']);
        expect(trie.children.has('empty-dir')).toBe(true);
        expect(trie.children.get('empty-dir')?.files).toHaveLength(0);
      });

      it('should create nested empty dir nodes', () => {
        const trie = buildTrie([], ['a/b/empty']);
        const aNode = trie.children.get('a');
        const bNode = aNode?.children.get('b');
        expect(bNode?.children.has('empty')).toBe(true);
      });

      it('should not overwrite an existing dir node with files', () => {
        const trie = buildTrie([{ path: 'docs/readme.md', mtime: 1 }], ['docs']);
        const docsNode = trie.children.get('docs');
        expect(docsNode?.files).toHaveLength(1);
      });
    });
  });

  describe('trieToTreeItems', () => {
    describe('sort by name asc', () => {
      it('should order files alphabetically ascending', () => {
        const trie = buildTrie(
          [
            { path: 'z.md', mtime: 1 },
            { path: 'a.md', mtime: 2 },
          ],
          [],
        );
        const items = trieToTreeItems(trie, '', 'name', 'asc');
        expect(items[0].name).toBe('a.md');
        expect(items[1].name).toBe('z.md');
      });
    });

    describe('sort by name desc', () => {
      it('should order files alphabetically descending', () => {
        const trie = buildTrie(
          [
            { path: 'a.md', mtime: 1 },
            { path: 'z.md', mtime: 2 },
          ],
          [],
        );
        const items = trieToTreeItems(trie, '', 'name', 'desc');
        expect(items[0].name).toBe('z.md');
        expect(items[1].name).toBe('a.md');
      });
    });

    describe('sort by mtime asc', () => {
      it('should order files by mtime ascending', () => {
        const trie = buildTrie(
          [
            { path: 'newer.md', mtime: 200 },
            { path: 'older.md', mtime: 100 },
          ],
          [],
        );
        const items = trieToTreeItems(trie, '', 'modified', 'asc');
        expect(items[0].name).toBe('older.md');
        expect(items[1].name).toBe('newer.md');
      });
    });

    describe('sort by mtime desc', () => {
      it('should order files by mtime descending', () => {
        const trie = buildTrie(
          [
            { path: 'older.md', mtime: 100 },
            { path: 'newer.md', mtime: 200 },
          ],
          [],
        );
        const items = trieToTreeItems(trie, '', 'modified', 'desc');
        expect(items[0].name).toBe('newer.md');
        expect(items[1].name).toBe('older.md');
      });
    });

    describe('directory items', () => {
      it('should produce expandable dir items with children array', () => {
        const trie = buildTrie([{ path: 'docs/index.md', mtime: 1 }], []);
        const items = trieToTreeItems(trie, '', 'name', 'asc');
        expect(items[0].id).toBe('dir:docs');
        expect(Array.isArray(items[0].children)).toBe(true);
      });

      it('should place dirs before files', () => {
        const trie = buildTrie(
          [
            { path: 'aaa.md', mtime: 1 },
            { path: 'sub/file.md', mtime: 2 },
          ],
          [],
        );
        const items = trieToTreeItems(trie, '', 'name', 'asc');
        expect(items[0].id).toBe('dir:sub');
        expect(items[1].id).toBe('aaa.md');
      });
    });

    describe('onDirClick wiring', () => {
      it('should attach onClick to dir items when onDirClick is provided', () => {
        const onDirClick = vi.fn();
        const trie = buildTrie([{ path: 'docs/index.md', mtime: 1 }], []);
        const items = trieToTreeItems(trie, '', 'name', 'asc', undefined, undefined, onDirClick);
        const dirItem = items[0];
        expect(dirItem.onClick).toBeDefined();
        dirItem.onClick!();
        expect(onDirClick).toHaveBeenCalledWith('docs');
      });

      it('should NOT attach onClick when onDirClick is absent', () => {
        const trie = buildTrie([{ path: 'docs/index.md', mtime: 1 }], []);
        const items = trieToTreeItems(trie, '', 'name', 'asc');
        expect(items[0].onClick).toBeUndefined();
      });

      it('should pass the correct nested dir path to onDirClick', () => {
        const onDirClick = vi.fn();
        const trie = buildTrie([{ path: 'a/b/file.md', mtime: 1 }], []);
        const items = trieToTreeItems(trie, '', 'name', 'asc', undefined, undefined, onDirClick);
        const nested = items[0].children![0];
        nested.onClick!();
        expect(onDirClick).toHaveBeenCalledWith('a/b');
      });
    });

    describe('dirActions and fileActions', () => {
      it('should attach actions from dirActions callback to dir items', () => {
        const dirActions = vi.fn(() => 'dir-action-node' as unknown as React.ReactNode);
        const trie = buildTrie([{ path: 'docs/index.md', mtime: 1 }], []);
        const items = trieToTreeItems(trie, '', 'name', 'asc', dirActions);
        expect(dirActions).toHaveBeenCalledWith('docs');
        expect(items[0].actions).toBe('dir-action-node');
      });

      it('should attach actions from fileActions callback to file items', () => {
        const fileActions = vi.fn(() => 'file-action-node' as unknown as React.ReactNode);
        const trie = buildTrie([{ path: 'readme.md', mtime: 1 }], []);
        const items = trieToTreeItems(trie, '', 'name', 'asc', undefined, fileActions);
        expect(fileActions).toHaveBeenCalledWith('readme.md');
        expect(items[0].actions).toBe('file-action-node');
      });
    });
  });

  describe('buildFileTree', () => {
    describe('filter matching', () => {
      it('should include files whose path contains the filter text (case-insensitive)', () => {
        const files = [
          { path: 'Notes/Meeting.md', mtime: 1 },
          { path: 'readme.md', mtime: 2 },
        ];
        const items = buildFileTree(files, [], 'name', 'asc', 'meeting');
        expect(items.some((i) => i.id === 'dir:Notes')).toBe(true);
        expect(items.some((i) => i.id === 'readme.md')).toBe(false);
      });

      it('should return all files when filter is empty', () => {
        const files = [
          { path: 'a.md', mtime: 1 },
          { path: 'b.md', mtime: 2 },
        ];
        const items = buildFileTree(files, [], 'name', 'asc', '');
        expect(items).toHaveLength(2);
      });

      it('should filter explicit dirs by the filter text', () => {
        const items = buildFileTree([], ['docs', 'archive'], 'name', 'asc', 'arch');
        expect(items.some((i) => i.id === 'dir:archive')).toBe(true);
        expect(items.some((i) => i.id === 'dir:docs')).toBe(false);
      });
    });
  });

  describe('parentPrefix', () => {
    it('should return the path up to and including the last slash', () => {
      expect(parentPrefix('docs/notes/file.md')).toBe('docs/notes/');
    });

    it('should return empty string for a root-level file', () => {
      expect(parentPrefix('file.md')).toBe('');
    });

    it('should handle a single directory segment', () => {
      expect(parentPrefix('docs/file.md')).toBe('docs/');
    });
  });

  describe('applyDefaultExtension', () => {
    it('should return the name unchanged when ext is undefined', () => {
      expect(applyDefaultExtension('readme', undefined)).toBe('readme');
    });

    it('should append the extension when the name does not already have it', () => {
      expect(applyDefaultExtension('notes', '.md')).toBe('notes.md');
    });

    it('should NOT double-append when the name already ends with the extension', () => {
      expect(applyDefaultExtension('notes.md', '.md')).toBe('notes.md');
    });

    it('should work with non-.md extensions', () => {
      expect(applyDefaultExtension('config', '.ts')).toBe('config.ts');
    });

    it('should not append if name ends with ext even for longer names', () => {
      expect(applyDefaultExtension('my-plan.md', '.md')).toBe('my-plan.md');
    });
  });
});
